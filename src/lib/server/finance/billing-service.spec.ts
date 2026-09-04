import { describe, it, expect, vi, beforeEach } from 'vitest';

// This file's own mocks, not a sibling's: a spec's mock set is a fixture, and
// unioning two quietly widens what each was testing.
const mockStripe = vi.hoisted(() => ({
	setupIntents: { create: vi.fn(), retrieve: vi.fn() },
	paymentMethods: { list: vi.fn(), detach: vi.fn() },
	subscriptions: { list: vi.fn(), update: vi.fn() },
	invoices: { list: vi.fn() }
}));
vi.mock('$lib/server/stripe', () => ({ stripe: mockStripe }));

const dbUpdate = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/db', () => ({
	db: {
		update: () => ({ set: (values: unknown) => ({ where: () => dbUpdate(values) }) })
	}
}));

const {
	createSetupIntent,
	listCards,
	listInvoices,
	removeCard,
	setDefaultCard,
	PaymentMethodError
} = await import('./billing-service');

const card = (id: string, last4: string) => ({
	id,
	object: 'payment_method',
	type: 'card',
	card: { brand: 'visa', last4, exp_month: 4, exp_year: 2031 }
});

beforeEach(() => {
	vi.clearAllMocks();
	mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
	mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });
	mockStripe.invoices.list.mockResolvedValue({ data: [] });
});

describe('createSetupIntent', () => {
	it('saves the card for a renewal nobody is present for', async () => {
		mockStripe.setupIntents.create.mockResolvedValue({ client_secret: 'seti_1_secret_x' });

		const secret = await createSetupIntent('cus_1');

		expect(secret).toBe('seti_1_secret_x');
		// `off_session` is load-bearing, not boilerplate: a card saved
		// `on_session` is refused when the subscription invoices itself a month
		// later, which the member would learn about from a dunning email.
		expect(mockStripe.setupIntents.create).toHaveBeenCalledWith({
			customer: 'cus_1',
			usage: 'off_session'
		});
	});

	it('throws rather than returning an empty secret', async () => {
		mockStripe.setupIntents.create.mockResolvedValue({ client_secret: null });

		await expect(createSetupIntent('cus_1')).rejects.toThrow('setup intent secret');
	});
});

describe('listCards', () => {
	it('marks the card the subscription actually bills', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({
			data: [card('pm_a', '4242'), card('pm_b', '1881')]
		});
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [{ id: 'sub_1', default_payment_method: 'pm_b' }]
		});

		const cards = await listCards('cus_1');

		expect(cards.map((c) => [c.id, c.isDefault])).toEqual([
			['pm_a', false],
			['pm_b', true]
		]);
	});

	it('reads the default through an expanded payment method too', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({ data: [card('pm_a', '4242')] });
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [{ id: 'sub_1', default_payment_method: { id: 'pm_a' } }]
		});

		expect((await listCards('cus_1'))[0].isDefault).toBe(true);
	});

	it('marks nothing default when there is no subscription to bill', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({ data: [card('pm_a', '4242')] });

		expect((await listCards('cus_1'))[0].isDefault).toBe(false);
	});
});

describe('setDefaultCard', () => {
	it('refuses a card that is not on this account', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({ data: [card('pm_mine', '4242')] });

		// A payment method id is unguessable in value but not in shape, which is
		// not a permission model. This is.
		await expect(setDefaultCard('user-1', 'cus_1', 'pm_someone_else')).rejects.toThrow(
			PaymentMethodError
		);
		expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
	});

	it('points the subscription at it and mirrors it onto the user row', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({ data: [card('pm_a', '4242')] });
		mockStripe.subscriptions.list.mockResolvedValue({ data: [{ id: 'sub_1' }] });

		await setDefaultCard('user-1', 'cus_1', 'pm_a');

		expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
			default_payment_method: 'pm_a'
		});
		expect(dbUpdate).toHaveBeenCalledWith({ pmType: 'visa', pmLastFour: '4242' });
	});

	it('remembers a card for a member with nothing to bill yet', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({ data: [card('pm_a', '4242')] });

		// Cancelled, or about to subscribe. The card is still theirs.
		await setDefaultCard('user-1', 'cus_1', 'pm_a');

		expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
		expect(dbUpdate).toHaveBeenCalledWith({ pmType: 'visa', pmLastFour: '4242' });
	});
});

describe('removeCard', () => {
	it('refuses to strand a live subscription with no card', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({ data: [card('pm_a', '4242')] });
		mockStripe.subscriptions.list.mockResolvedValue({ data: [{ id: 'sub_1' }] });

		// Stripe would accept the detach and then fail the next renewal, which the
		// member finds out about from a dunning email rather than from this page.
		await expect(removeCard('user-1', 'cus_1', 'pm_a')).rejects.toThrow(PaymentMethodError);
		expect(mockStripe.paymentMethods.detach).not.toHaveBeenCalled();
	});

	it('lets the last card go when there is no subscription behind it', async () => {
		mockStripe.paymentMethods.list.mockResolvedValue({ data: [card('pm_a', '4242')] });

		await removeCard('user-1', 'cus_1', 'pm_a');

		expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith('pm_a');
	});

	it('promotes a survivor rather than leaving the subscription on a detached card', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [{ id: 'sub_1', default_payment_method: 'pm_a' }]
		});
		mockStripe.paymentMethods.list
			// ownedCard, then listCards for the count, then listCards after the detach
			.mockResolvedValueOnce({ data: [card('pm_a', '4242'), card('pm_b', '1881')] })
			.mockResolvedValueOnce({ data: [card('pm_a', '4242'), card('pm_b', '1881')] })
			.mockResolvedValue({ data: [card('pm_b', '1881')] });

		await removeCard('user-1', 'cus_1', 'pm_a');

		expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith('pm_a');
		// Stripe falls back to the *customer's* default, which this app has never
		// set — so "it will figure it out" is not true here.
		expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
			default_payment_method: 'pm_b'
		});
	});
});

describe('listInvoices', () => {
	it('leaves out a draft, whose amount can still change', async () => {
		mockStripe.invoices.list.mockResolvedValue({
			data: [
				{ id: 'in_1', created: 1_700_000_000, amount_paid: 1500, status: 'paid' },
				{ id: 'in_2', created: 1_700_000_100, amount_paid: 0, status: 'draft' }
			]
		});

		const invoices = await listInvoices('cus_1');

		expect(invoices.map((i) => i.id)).toEqual(['in_1']);
		expect(invoices[0].amountPaidCents).toBe(1500);
		expect(invoices[0].created).toEqual(new Date(1_700_000_000 * 1000));
	});

	it("carries Stripe's own receipt and PDF through", async () => {
		mockStripe.invoices.list.mockResolvedValue({
			data: [
				{
					id: 'in_1',
					created: 1_700_000_000,
					amount_paid: 1500,
					status: 'paid',
					hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
					invoice_pdf: 'https://invoice.stripe.com/i/abc.pdf'
				}
			]
		});

		const [invoice] = await listInvoices('cus_1');

		expect(invoice.hostedUrl).toBe('https://invoice.stripe.com/i/abc');
		expect(invoice.pdfUrl).toBe('https://invoice.stripe.com/i/abc.pdf');
	});
});
