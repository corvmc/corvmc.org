import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import type { PaymentGateway } from './types';

vi.mock('$env/dynamic/private', () => ({
	env: { STRIPE_SECRET_KEY: 'sk_test_contract_spec' }
}));

const { createFakeGateway, resetFakeGateway, completeFakeCheckout, outcomeForCard } =
	await import('./fake-gateway');
const { createStripeGateway } = await import('./stripe-gateway');

/**
 * The fidelity guard for the fake.
 *
 * Half of it is free: both factories are declared `() => PaymentGateway`, and
 * the port is `Pick`ed off Stripe's own resource types, so `pnpm check` already
 * proves the fake's signatures match the live SDK's. What the compiler cannot
 * see is a method that exists but does nothing useful, or a shape the app reads
 * that the fake never populates — so the structural sweep below walks both
 * implementations, and the behavioural cases assert the specific invariants
 * `payment-service` and the checkout listeners depend on.
 */

/** Flat resources the port declares. Nested ones are covered by NESTED_SURFACE below. */
const PORT_SURFACE: ReadonlyArray<readonly [keyof PaymentGateway, readonly string[]]> = [
	['accountLinks', ['create']],
	['accounts', ['create', 'retrieve', 'createLoginLink']],
	['coupons', ['create', 'del']],
	['customers', ['create']],
	['invoices', ['list']],
	['paymentIntents', ['retrieve']],
	['paymentRecords', ['reportPayment', 'reportRefund', 'retrieve']],
	['prices', ['retrieve']],
	['products', ['list', 'create', 'update']],
	['refunds', ['create']],
	['subscriptions', ['list', 'update', 'retrieve']]
];

const NESTED_SURFACE = [
	['billingPortal', 'sessions', ['create']],
	['checkout', 'sessions', ['create', 'retrieve', 'list']]
] as const;

describe('PaymentGateway contract', () => {
	beforeEach(() => {
		resetFakeGateway();
	});

	describe.each([
		['fake', createFakeGateway],
		// The real gateway is constructed but never called: every method below is
		// only probed for existence, which needs no network and no valid key. Its
		// *signatures* are checked by the compiler, which is the half of the
		// contract a running assertion could not cover anyway.
		['stripe', createStripeGateway]
	])('%s implementation', (_name, factory) => {
		const gateway = factory();

		it.each(PORT_SURFACE)('exposes %s with its declared methods', (resource, methods) => {
			const target = gateway[resource] as Record<string, unknown>;
			expect(target).toBeTypeOf('object');
			for (const method of methods) {
				expect(typeof target[method]).toBe('function');
			}
		});

		it.each(NESTED_SURFACE)('exposes %s.%s methods', (resource, nested, methods) => {
			const target = (gateway[resource] as Record<string, Record<string, unknown>>)[nested];
			for (const method of methods) {
				expect(typeof target[method]).toBe('function');
			}
		});
	});
});

describe('fake gateway behaviour', () => {
	let gateway: PaymentGateway;

	beforeEach(() => {
		resetFakeGateway();
		gateway = createFakeGateway();
	});

	const lineItem = (unitAmount: number, quantity = 1) => ({
		price_data: {
			currency: 'usd',
			product: 'prod_test',
			unit_amount: unitAmount
		},
		quantity
	});

	it('onboards a connected account as ready to take charges', async () => {
		const account = await gateway.accounts.create({ type: 'express' });

		// The fake reports an account that can already sell, because the whole
		// point of a local Connect account is to reach the record-sale flow the
		// real Express onboarding gates behind a human and a hosted form.
		expect(account.id).toMatch(/^acct_/);
		expect(account.charges_enabled).toBe(true);
		expect(account.payouts_enabled).toBe(true);

		const retrieved = await gateway.accounts.retrieve(account.id);
		expect(retrieved.id).toBe(account.id);
	});

	it('mints an onboarding link that returns to where the caller asked', async () => {
		const link = await gateway.accountLinks.create({
			account: 'acct_fake',
			refresh_url: 'https://example.com/refresh',
			return_url: 'https://example.com/return',
			type: 'account_onboarding'
		});

		expect(link.url).toBe('https://example.com/refresh');
	});

	it('totals inline price_data the way Checkout does', async () => {
		const session = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(1500, 2), lineItem(250)],
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});

		expect(session.amount_subtotal).toBe(3250);
		expect(session.amount_total).toBe(3250);
	});

	it('applies a coupon discount to the total but not the subtotal', async () => {
		const coupon = await gateway.coupons.create({
			amount_off: 1000,
			currency: 'usd',
			max_redemptions: 1
		});

		const session = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(2500)],
			discounts: [{ coupon: coupon.id }],
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});

		expect(session.amount_subtotal).toBe(2500);
		expect(session.amount_total).toBe(1500);
	});

	it('never returns a negative total when credits exceed the cart', async () => {
		const coupon = await gateway.coupons.create({ amount_off: 9999, currency: 'usd' });
		const session = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(500)],
			discounts: [{ coupon: coupon.id }],
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});

		expect(session.amount_total).toBe(0);
	});

	it('sends the customer to a local page instead of checkout.stripe.com', async () => {
		const session = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(500)],
			success_url: 'https://example.test/events/1/tickets/success',
			cancel_url: 'https://example.test/events/1/tickets'
		});

		expect(session.url).toBe(`https://example.test/checkout/${session.id}`);
	});

	it('mints a client secret for an elements session, keyed to that session', async () => {
		// `ui_mode: 'elements'` is what `checkout({ uiMode: 'elements' })` sends,
		// and the client secret is the only thing the Payment Element can be
		// initialised from. A fake that returned a constant here would let a page
		// mount against the wrong session and never notice.
		const first = await gateway.checkout.sessions.create({
			mode: 'payment',
			ui_mode: 'elements',
			line_items: [lineItem(500)],
			return_url: 'https://example.test/events/1/tickets/success'
		});
		const second = await gateway.checkout.sessions.create({
			mode: 'payment',
			ui_mode: 'elements',
			line_items: [lineItem(500)],
			return_url: 'https://example.test/events/1/tickets/success'
		});

		expect(first.ui_mode).toBe('elements');
		expect(first.client_secret).toEqual(expect.any(String));
		expect(first.client_secret).not.toBe(second.client_secret);
	});

	it('completes an elements session the same way as a hosted one', async () => {
		// Fulfillment must not depend on which UI took the money: the checkout
		// listeners read `metadata` and `payment_intent` off the completed session
		// and know nothing about ui_mode.
		const created = await gateway.checkout.sessions.create({
			mode: 'payment',
			ui_mode: 'elements',
			line_items: [lineItem(1500)],
			metadata: { type: 'ticket', purchase_id: 'pur_1' },
			return_url: 'https://example.test/events/1/tickets/success'
		});

		const completed = completeFakeCheckout(created.id);

		expect(completed.status).toBe('complete');
		expect(completed.payment_status).toBe('paid');
		expect(completed.metadata).toEqual({ type: 'ticket', purchase_id: 'pur_1' });
		expect(completed.payment_intent).toEqual(expect.any(String));
	});

	it('retrieves a session it created, with metadata intact', async () => {
		const created = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(500)],
			metadata: { reservation_id: 'res_1', credits_applied_cents: '0' },
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});

		const retrieved = await gateway.checkout.sessions.retrieve(created.id);

		expect(retrieved.id).toBe(created.id);
		expect(retrieved.metadata).toEqual({ reservation_id: 'res_1', credits_applied_cents: '0' });
	});

	it('throws for an unknown session rather than resolving undefined', async () => {
		await expect(gateway.checkout.sessions.retrieve('cs_missing')).rejects.toThrow(
			/No such checkout session/
		);
	});

	it('completes a payment session into a paid session with a PaymentIntent', async () => {
		const created = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(4200)],
			metadata: { ticket_purchase_id: 'tp_1' },
			payment_intent_data: { metadata: { credits_breakdown: '[]' } },
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});

		const completed = completeFakeCheckout(created.id);

		expect(completed.status).toBe('complete');
		expect(completed.payment_status).toBe('paid');
		expect(completed.payment_intent).toMatch(/^pi_fake_/);

		// `refundPaymentIntent` reads the breakdown off the intent, not the session.
		const intent = await gateway.paymentIntents.retrieve(completed.payment_intent as string);
		expect(intent.metadata).toEqual({ credits_breakdown: '[]' });
	});

	it('reports a fully credit-covered session as requiring no payment', async () => {
		const created = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(0)],
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});

		expect(completeFakeCheckout(created.id).payment_status).toBe('no_payment_required');
	});

	it('completes a subscription session into a subscription and a paid invoice', async () => {
		const created = await gateway.checkout.sessions.create({
			mode: 'subscription',
			customer: 'cus_seed_1',
			line_items: [lineItem(1000)],
			success_url: 'https://example.test/member/membership',
			cancel_url: 'https://example.test/member/membership'
		});

		const completed = completeFakeCheckout(created.id);
		expect(completed.subscription).toMatch(/^sub_fake_/);

		const subscription = await gateway.subscriptions.retrieve(completed.subscription as string);
		expect(subscription.status).toBe('active');

		const invoices = await gateway.invoices.list({ customer: 'cus_seed_1' });
		expect(invoices.data).toHaveLength(1);
	});

	it('finds a session by its payment_intent, which is how refunds recover the breakdown', async () => {
		const created = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(800)],
			metadata: { credits_breakdown: '[{"type":"free_hours","units":2}]' },
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});
		const completed = completeFakeCheckout(created.id);

		const found = await gateway.checkout.sessions.list({
			payment_intent: completed.payment_intent as string,
			limit: 1
		});

		expect(found.data[0]?.id).toBe(created.id);
	});

	it('round-trips a cash payment record and its refund', async () => {
		const record = await gateway.paymentRecords.reportPayment({
			amount_requested: { value: 2500, currency: 'usd' },
			initiated_at: 0,
			metadata: { reservation_id: 'res_9' },
			outcome: 'guaranteed',
			payment_method_details: {
				custom: { display_name: 'Cash', type: 'custom' },
				type: 'custom'
			}
		});

		expect(record.amount.value).toBe(2500);

		const refunded = await gateway.paymentRecords.reportRefund(record.id, {
			amount: { value: 2500, currency: 'usd' },
			initiated_at: 0,
			outcome: 'refunded',
			processor_details: { type: 'custom' }
		});

		expect(refunded.amount_refunded).toEqual(record.amount);
	});

	it('marks a refunded charge so a second refund is a no-op', async () => {
		const created = await gateway.checkout.sessions.create({
			mode: 'payment',
			line_items: [lineItem(3000)],
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});
		const intentId = completeFakeCheckout(created.id).payment_intent as string;

		await gateway.refunds.create({ payment_intent: intentId });

		const intent = await gateway.paymentIntents.retrieve(intentId);
		const charge = intent.latest_charge as Stripe.Charge;
		expect(charge.amount_captured - charge.amount_refunded).toBe(0);
	});

	it('reuses an existing product by corvmc_key instead of creating a second one', async () => {
		const created = await gateway.products.create({
			name: 'Sustaining contribution',
			metadata: { corvmc_key: 'contribution' }
		});

		const listed = await gateway.products.list({ active: true });
		const matching = listed.data.filter((p) => p.metadata?.corvmc_key === 'contribution');

		expect(matching.map((p) => p.id)).toEqual([created.id]);
	});

	it('iterates a list with for-await, which the sync sweep relies on', async () => {
		await gateway.customers.create({ email: 'a@example.test' });
		const first = await gateway.checkout.sessions.create({
			mode: 'subscription',
			customer: 'cus_seed_2',
			line_items: [lineItem(1000)],
			success_url: 'https://example.test/done',
			cancel_url: 'https://example.test/back'
		});
		completeFakeCheckout(first.id);

		const seen: string[] = [];
		for await (const subscription of gateway.subscriptions.list({ status: 'all' })) {
			seen.push(subscription.id);
		}

		expect(seen).toHaveLength(1);
	});
});

describe('fake test cards', () => {
	it.each([
		['4242424242424242', 'succeed'],
		['4000000000000002', 'decline'],
		['4000000000009995', 'insufficient_funds']
	])('maps %s to %s', (number, outcome) => {
		expect(outcomeForCard(number)).toBe(outcome);
	});

	it('tolerates the spacing a human types', () => {
		expect(outcomeForCard('4242 4242 4242 4242')).toBe('succeed');
	});

	it('does not recognise an arbitrary number', () => {
		expect(outcomeForCard('1234567812345678')).toBeUndefined();
	});
});
