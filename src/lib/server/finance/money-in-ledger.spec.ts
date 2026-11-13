import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * Every money-in path, through its real writer into a real ledger: one
 * payment's rows sum to what Stripe leaves in the balance, the charge less the
 * card fee, with the fee as exactly one `spent` row (#2731). Amounts come from
 * the same split the sale used, never a hand-picked fixture.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/env/private', async () => (await import('#lib/testing/env-mock.js')).envMock({}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { initStripe } = await import('#lib/server/stripe.js');
const { createFakeGateway, resetFakeGateway, completeFakeTerminalPayment } =
	await import('#lib/server/finance/gateway/fake-gateway.js');
const { calculateCardPresentFee, calculateProcessingFee } = await import('#lib/finance/fees.js');
const { actsAnchoredCollectiveCents, validateTicketSplit } =
	await import('#lib/finance/ticket-split.js');
const { handlePaymentIntentSucceeded } = await import('./webhook-handlers');
const { handleCheckoutEntries } = await import('./checkout-entries-listener');
const { ticketSplitMetadata } = await import('./ticket-entries');
const { recordReservationCardPresent } = await import('./reservation-entries');
const { recordMembershipInvoice } = await import('./membership-entries');
const { startDoorDonation } = await import('./door-donation');
const { startDoorSale } = await import('#lib/server/ticket/door-sale.js');

const NOW = new Date('2026-09-24T19:00:00Z');
const tonight = Math.floor(NOW.getTime() / 1000) + 3600;

/** One payment's rows, found by the subject they are written against. */
function ledger(subjectId: string) {
	const rows = sqlite
		.prepare(
			`select amount_cents, kind, category from financial_entry
			  where subject_id = ? and kind <> 'in_kind'`
		)
		.all(subjectId) as { amount_cents: number; kind: string; category: string }[];
	return {
		sum: rows.reduce((t, r) => t + r.amount_cents, 0),
		fees: rows.filter((r) => r.category === 'card_fees').map((r) => r.amount_cents)
	};
}

function expectNetOfOneFee(subjectId: string, chargeCents: number, feeCents: number) {
	const { sum, fees } = ledger(subjectId);
	expect(fees).toEqual([-feeCents]);
	expect(sum).toBe(chargeCents - feeCents);
}

function session(metadata: Record<string, string>, amountTotal: number) {
	return {
		id: `cs_${metadata.purchase_id ?? metadata.reservation_id ?? metadata.vendor_id}`,
		payment_intent: `pi_${metadata.purchase_id ?? metadata.reservation_id ?? metadata.vendor_id}`,
		amount_total: amountTotal,
		metadata
	} as unknown as Stripe.Checkout.Session;
}

/** The session `buyTickets` opens, from the split it validated. */
async function onlineTicket(
	purchaseId: string,
	input: { unitPriceCents: number; quantity: number; coverFees: boolean; suggested: number }
) {
	const { unitPriceCents, quantity, coverFees, suggested } = input;
	const collectiveCents = actsAnchoredCollectiveCents({
		baseCents: suggested * quantity,
		grossPaidCents: unitPriceCents * quantity,
		coverFees
	});
	const result = validateTicketSplit({
		unitPriceCents,
		quantity,
		collectiveCents,
		coverFees,
		suggestedUnitCents: suggested,
		floorCents: 0
	});
	if (!result.ok) throw new Error(result.reason);
	const { split } = result;
	await handleCheckoutEntries(
		session(
			{
				type: 'ticket',
				purchase_id: purchaseId,
				event_id: 'tonight',
				ticket_quantity: String(quantity),
				...ticketSplitMetadata(split)
			},
			split.chargeCents
		)
	);
	return split;
}

beforeEach(() => {
	for (const t of ['financial_entry', 'ticket', 'ticket_sale', 'donation', 'event_listing'])
		sqlite.exec(`delete from ${t}`);
	resetFakeGateway();
	initStripe(createFakeGateway());
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		 values ('tonight', 'Show', ${tonight}, ${tonight + 10800}, 'published', 'cmc', 'show', 'staff-1')`
	);
	sqlite.exec(
		`insert into ticket_sale (id, event_listing_id, enabled, price_cents, price_floor_cents)
		 values ('sale-1', 'tonight', 1, 1000, 0)`
	);
});

describe('one payment nets to the charge less one card fee', () => {
	it.each([
		['at the suggested price', { unitPriceCents: 1000, quantity: 1, coverFees: false }],
		['under it', { unitPriceCents: 700, quantity: 1, coverFees: false }],
		['over it', { unitPriceCents: 2500, quantity: 2, coverFees: false }],
		['with the fee covered', { unitPriceCents: 1000, quantity: 2, coverFees: true }]
	])('an online ticket %s', async (_, input) => {
		const split = await onlineTicket('pur-1', { ...input, suggested: 1000 });
		expectNetOfOneFee('pur-1', split.chargeCents, calculateProcessingFee(split.chargeCents));
	});

	it("a band's own ticket, whose share never reaches the balance", async () => {
		await handleCheckoutEntries(
			session(
				{
					type: 'ticket',
					ticket_seller_group_id: 'band-1',
					purchase_id: 'pur-band',
					ticket_acts_cents: '900'
				},
				1000
			)
		);
		expectNetOfOneFee('pur-band', 1000 - 900, calculateProcessingFee(1000));
	});

	it('a door ticket, tapped and confirmed by the webhook', async () => {
		const start = await startDoorSale({
			eventId: 'tonight',
			quantity: 2,
			unitPriceCents: 1500,
			staffUserId: 'staff-1',
			now: NOW
		});
		if (start.kind !== 'card') throw new Error('expected a card sale');
		await handlePaymentIntentSucceeded(completeFakeTerminalPayment(start.paymentIntentId));
		expectNetOfOneFee(
			start.paymentIntentId,
			start.chargeCents,
			calculateCardPresentFee(start.chargeCents)
		);
	});

	it('a door gift', async () => {
		const start = await startDoorDonation({
			eventId: 'tonight',
			amountCents: 2000,
			staffUserId: 'staff-1',
			now: NOW
		});
		await handlePaymentIntentSucceeded(completeFakeTerminalPayment(start.paymentIntentId));
		expectNetOfOneFee(start.paymentIntentId, 2000, calculateCardPresentFee(2000));
	});

	it('a reservation paid online', async () => {
		await handleCheckoutEntries(session({ reservation_id: 'res-1' }, 3000));
		expectNetOfOneFee('res-1', 3000, calculateProcessingFee(3000));
	});

	it('a reservation paid at the reader', async () => {
		await recordReservationCardPresent({
			reservationId: 'res-2',
			userId: 'u-1',
			amountCents: 3000,
			stripePaymentRecordId: 'pi_res-2',
			occurredAt: NOW
		});
		expectNetOfOneFee('res-2', 3000, calculateCardPresentFee(3000));
	});

	it('a market table fee', async () => {
		await handleCheckoutEntries(
			session({ type: 'market_vendor_fee', vendor_id: 'vendor-1' }, 2500)
		);
		expectNetOfOneFee('vendor-1', 2500, calculateProcessingFee(2500));
	});

	it('a membership contribution', async () => {
		await recordMembershipInvoice({
			userId: 'u-1',
			userName: 'A',
			userEmail: 'a@example.com',
			amountCents: 1000,
			freeHoursPerMonth: 0,
			periodEnd: '2026-10-24',
			invoiceId: 'in_1',
			coveringFees: false
		});
		expectNetOfOneFee('in_1', 1000, calculateProcessingFee(1000));
	});
});
