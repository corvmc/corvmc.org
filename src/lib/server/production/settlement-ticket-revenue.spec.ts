import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * A ticket sold for a show reaches that show's settlement, through the real
 * writers into a migrated SQLite (#2733). Each sale's charge, less its one card
 * fee, lands in the collective's revenue or the acts' pool and nowhere else.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));
vi.mock('$app/env/private', async () => (await import('#lib/testing/env-mock.js')).envMock({}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { initStripe } = await import('#lib/server/stripe.js');
const { createFakeGateway, resetFakeGateway, completeFakeTerminalPayment } =
	await import('#lib/server/finance/gateway/fake-gateway.js');
const { calculateCardPresentFee, calculateProcessingFee } = await import('#lib/finance/fees.js');
const { actsAnchoredCollectiveCents, validateTicketSplit } =
	await import('#lib/finance/ticket-split.js');
const { handlePaymentIntentSucceeded } = await import('#lib/server/finance/webhook-handlers.js');
const { handleCheckoutEntries } = await import('#lib/server/finance/checkout-entries-listener.js');
const { ticketSplitMetadata } = await import('#lib/server/finance/ticket-entries.js');
const { createTickets } = await import('#lib/server/ticket/ticket-service.js');
const { startDoorSale } = await import('#lib/server/ticket/door-sale.js');
const { getSettlement } = await import('./settlement-service');

const NOW = new Date('2026-09-24T19:00:00Z');
const tonight = Math.floor(NOW.getTime() / 1000) + 3600;
const SUGGESTED = 1000;

/** Mints the purchase as `buyTickets` does, then completes its checkout. */
async function onlineTicket(
	eventId: string,
	purchaseId: string,
	input: { unitPriceCents: number; quantity: number; coverFees: boolean }
): Promise<{ chargeCents: number; feeCents: number }> {
	const { unitPriceCents, quantity, coverFees } = input;
	const result = validateTicketSplit({
		unitPriceCents,
		quantity,
		collectiveCents: actsAnchoredCollectiveCents({
			baseCents: SUGGESTED * quantity,
			grossPaidCents: unitPriceCents * quantity,
			coverFees
		}),
		coverFees,
		suggestedUnitCents: SUGGESTED,
		floorCents: 0
	});
	if (!result.ok) throw new Error(result.reason);
	const { split } = result;
	await createTickets({
		eventId,
		purchaseId,
		quantity,
		attendeeName: 'Buyer',
		attendeeEmail: 'buyer@example.com',
		unitPriceCents: split.ticketLineUnitCents,
		actsCents: split.actsCents,
		collectiveCents: split.collectiveCents
	});
	await handleCheckoutEntries({
		id: `cs_${purchaseId}`,
		payment_intent: `pi_${purchaseId}`,
		amount_total: split.chargeCents,
		metadata: {
			type: 'ticket',
			purchase_id: purchaseId,
			event_id: eventId,
			ticket_quantity: String(quantity),
			...ticketSplitMetadata(split)
		}
	} as unknown as Stripe.Checkout.Session);
	return { chargeCents: split.chargeCents, feeCents: calculateProcessingFee(split.chargeCents) };
}

async function doorTicket(eventId: string, unitPriceCents: number, quantity: number) {
	const start = await startDoorSale({
		eventId,
		quantity,
		unitPriceCents,
		staffUserId: 'staff-1',
		now: NOW
	});
	if (start.kind !== 'card') throw new Error('expected a card sale');
	await handlePaymentIntentSucceeded(completeFakeTerminalPayment(start.paymentIntentId));
	return { chargeCents: start.chargeCents, feeCents: calculateCardPresentFee(start.chargeCents) };
}

/** What the show's settlement says the tickets brought in, both sides. */
async function ticketTake(eventId: string) {
	const s = await getSettlement(eventId);
	if (!s) throw new Error('no settlement');
	return s.collectiveRevenueCents + s.actsPoolCents;
}

function show(id: string) {
	sqlite.exec(`
		insert into project (id, name, kind) values ('proj-${id}', 'Show', 'production');
		insert into production (id, status, project_id) values ('prod-${id}', 'completed', 'proj-${id}');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id, project_id)
			values ('${id}', 'Show', ${tonight}, ${tonight + 10800}, 'published', 'cmc', 'show', 'staff-1', 'proj-${id}');
		insert into ticket_sale (id, event_listing_id, enabled, price_cents, price_floor_cents)
			values ('sale-${id}', '${id}', 1, ${SUGGESTED}, 0);
	`);
}

beforeEach(() => {
	for (const t of [
		'financial_entry',
		'donation',
		'ticket',
		'ticket_sale',
		'event_listing',
		'production',
		'project'
	])
		sqlite.exec(`delete from ${t}`);
	resetFakeGateway();
	initStripe(createFakeGateway());
	show('tonight');
	show('elsewhere');
});

describe('a show settles every ticket sold for it, net of its card fee', () => {
	it.each([
		['at the suggested price', { unitPriceCents: 1000, quantity: 1, coverFees: false }],
		['under it', { unitPriceCents: 700, quantity: 1, coverFees: false }],
		['over it', { unitPriceCents: 2500, quantity: 2, coverFees: false }],
		['with the fee covered', { unitPriceCents: 1000, quantity: 2, coverFees: true }]
	])('an online ticket %s', async (_, input) => {
		const sale = await onlineTicket('tonight', 'pur-1', input);
		expect(await ticketTake('tonight')).toBe(sale.chargeCents - sale.feeCents);
	});

	it('a door ticket, tapped and confirmed by the webhook', async () => {
		const sale = await doorTicket('tonight', 1500, 2);
		expect(await ticketTake('tonight')).toBe(sale.chargeCents - sale.feeCents);
	});

	it('only the tickets sold for that show', async () => {
		const online = await onlineTicket('tonight', 'pur-1', {
			unitPriceCents: 1000,
			quantity: 1,
			coverFees: false
		});
		const door = await doorTicket('tonight', 1200, 1);
		await onlineTicket('elsewhere', 'pur-2', {
			unitPriceCents: 3000,
			quantity: 1,
			coverFees: false
		});

		expect(await ticketTake('tonight')).toBe(
			online.chargeCents - online.feeCents + door.chargeCents - door.feeCents
		);
	});
});

describe("the door's figures beside the settlement", () => {
	// A gift is the show's, and stays out of what the bands are owed (#2799).
	it('lists paid door donations beside the night, outside the pool and the net', async () => {
		await doorTicket('tonight', 1500, 1);
		const before = await getSettlement('tonight');
		sqlite.exec(
			`insert into donation (id, payment_intent_id, event_id, amount_cents, status)
			 values ('gift-1', 'pi_gift_1', 'tonight', 2500, 'paid')`
		);
		const after = await getSettlement('tonight');

		expect(after?.doorTakings.donations).toEqual({ count: 1, grossCents: 2500 });
		expect(after?.actsPoolCents).toBe(before?.actsPoolCents);
		expect(after?.netCents).toBe(before?.netCents);
	});

	// The typed headcount needs a figure to be read against (#2801).
	it('carries how many tickets were checked in', async () => {
		await doorTicket('tonight', 1500, 2);
		expect((await getSettlement('tonight'))?.doorTakings.checkedIn).toBe(2);
	});
});
