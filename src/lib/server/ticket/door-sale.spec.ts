import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Door sales against a real SQLite, and the fake gateway standing in for Stripe. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const recordDoorTicketSale = vi.fn(async () => undefined);
const recordFreeTicketSale = vi.fn(async () => undefined);
vi.mock('$lib/server/finance/ticket-entries', () => ({
	recordDoorTicketSale: (...a: unknown[]) => recordDoorTicketSale(...(a as [])),
	recordFreeTicketSale: (...a: unknown[]) => recordFreeTicketSale(...(a as []))
}));

const { initStripe, stripe } = await import('$lib/server/stripe');
const { createFakeGateway, resetFakeGateway, completeFakeTerminalPayment } =
	await import('$lib/server/finance/gateway/fake-gateway');
const {
	listDoorEvents,
	startDoorSale,
	fulfillDoorSale,
	cancelDoorSale,
	getDoorSale,
	doorSaleEventId,
	DoorSaleError
} = await import('./door-sale');

const NOW = new Date('2026-09-24T19:00:00Z');
const at = (hoursFromNow: number) => Math.floor(NOW.getTime() / 1000) + hoursFromNow * 3600;

function listing(id: string, source: string, startsAt: number, status = 'published') {
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		 values ('${id}', 'Show ${id}', ${startsAt}, ${startsAt + 10800}, '${status}', '${source}', 'show', 'staff-1')`
	);
}

function sale(
	eventId: string,
	over: { price?: number; floor?: number; qty?: number; group?: string }
) {
	sqlite.exec(
		`insert into ticket_sale (id, event_listing_id, group_id, enabled, price_cents, price_floor_cents, quantity)
		 values ('sale-${eventId}', '${eventId}', ${over.group ? `'${over.group}'` : 'null'}, 1,
		   ${over.price ?? 'null'}, ${over.floor ?? 0}, ${over.qty ?? 'null'})`
	);
}

const rows = (purchaseId: string) =>
	sqlite
		.prepare(
			`select status, attendee_name, unit_price_cents, checked_in_by_user_id,
			        checked_in_at, stripe_payment_record_id, acts_cents, collective_cents
			   from ticket where purchase_id = ? order by code`
		)
		.all(purchaseId) as Record<string, unknown>[];

beforeEach(() => {
	for (const table of ['ticket', 'ticket_sale', 'event_listing'])
		sqlite.exec(`delete from ${table}`);
	resetFakeGateway();
	initStripe(createFakeGateway());
	vi.clearAllMocks();

	listing('tonight', 'cmc', at(1));
	sale('tonight', { price: 1500, floor: 0 });
});

describe('which shows the door can sell', () => {
	it("lists tonight's collective show with its price and what remains", async () => {
		listing('capped', 'cmc', at(2));
		sale('capped', { price: 1000, floor: 500, qty: 50 });
		const events = await listDoorEvents(NOW);
		expect(events.map((e) => e.id).sort()).toEqual(['capped', 'tonight']);
		expect(events.find((e) => e.id === 'capped')).toMatchObject({
			suggestedCents: 1000,
			floorCents: 500,
			remaining: 50,
			onlineSales: true
		});
	});

	it("leaves out a band's own gig, a band listing, a draft, and next week", async () => {
		listing('band-sold', 'cmc', at(1));
		sale('band-sold', { price: 1000, group: 'band-1' });
		listing('band-listing', 'band', at(1));
		listing('draft', 'cmc', at(1), 'draft');
		listing('next-week', 'cmc', at(24 * 7));
		expect((await listDoorEvents(NOW)).map((e) => e.id)).toEqual(['tonight']);
	});
});

describe('starting a door sale', () => {
	const start = (over: Partial<Parameters<typeof startDoorSale>[0]> = {}) =>
		startDoorSale({
			eventId: 'tonight',
			quantity: 2,
			unitPriceCents: 1500,
			staffUserId: 'staff-1',
			now: NOW,
			...over
		});

	it('creates a card-present intent for the whole order, and holds the seats', async () => {
		const result = await start();
		if (result.kind !== 'card') throw new Error('expected a card sale');

		const intent = await stripe.paymentIntents.retrieve(result.paymentIntentId);
		expect(intent).toMatchObject({
			amount: 3000,
			payment_method_types: ['card_present'],
			capture_method: 'automatic',
			metadata: { type: 'door_ticket', event_id: 'tonight', staff_user_id: 'staff-1' }
		});
		expect(result.clientSecret).toBe(intent.client_secret);

		const minted = rows(result.paymentIntentId);
		expect(minted).toHaveLength(2);
		expect(minted.every((r) => r.status === 'pending' && r.attendee_name === 'Door sale')).toBe(
			true
		);
	});

	it('writes the split once per order, not per ticket', async () => {
		const result = await start();
		if (result.kind !== 'card') throw new Error('expected a card sale');
		const minted = rows(result.paymentIntentId);
		expect(minted.reduce((sum, r) => sum + Number(r.acts_cents), 0)).toBe(2100);
		expect(minted.filter((r) => Number(r.acts_cents) > 0)).toHaveLength(1);
	});

	it('lets someone in free below the minimum, checked in on the spot', async () => {
		const result = await start({ unitPriceCents: 100, quantity: 1 });
		expect(result.kind).toBe('free');
		if (result.kind !== 'free') return;
		expect(result.purchaseId).toMatch(/^door-/);
		expect(rows(result.purchaseId)).toEqual([
			expect.objectContaining({ status: 'checked_in', checked_in_by_user_id: 'staff-1' })
		]);
		expect(recordFreeTicketSale).toHaveBeenCalledWith(
			expect.objectContaining({ purchaseId: result.purchaseId, quantity: 1 })
		);
	});

	it("refuses a band's own gig", async () => {
		listing('band-sold', 'cmc', at(1));
		sale('band-sold', { price: 1000, group: 'band-1' });
		await expect(start({ eventId: 'band-sold' })).rejects.toBeInstanceOf(DoorSaleError);
	});

	it('refuses under the floor', async () => {
		listing('floored', 'cmc', at(1));
		sale('floored', { price: 1500, floor: 1000 });
		await expect(start({ eventId: 'floored', unitPriceCents: 900 })).rejects.toThrow(/at least/);
	});

	it('sells past capacity, and the door then reads how far over it is', async () => {
		listing('capped', 'cmc', at(1));
		sale('capped', { price: 1000, qty: 1 });
		const result = await start({ eventId: 'capped', quantity: 3, unitPriceCents: 1000 });
		if (result.kind !== 'card') throw new Error('expected a card sale');
		await fulfillDoorSale(completeFakeTerminalPayment(result.paymentIntentId));
		const capped = (await listDoorEvents(NOW)).find((e) => e.id === 'capped');
		expect(capped?.remaining).toBe(-2);
	});
});

describe("a door sale's show", () => {
	it('is the show its tickets were minted for, which the start also reports', async () => {
		const result = await startDoorSale({
			eventId: 'tonight',
			quantity: 1,
			unitPriceCents: 1500,
			staffUserId: 'staff-1',
			now: NOW
		});
		if (result.kind !== 'card') throw new Error('expected a card sale');
		expect(result.eventId).toBe('tonight');
		expect(await doorSaleEventId(result.paymentIntentId)).toBe('tonight');
	});

	it('is null for an id that is not a door card sale', async () => {
		expect(await doorSaleEventId('pi_unknown')).toBeNull();
		expect(await doorSaleEventId('0b8e1c0a-online-purchase')).toBeNull();
	});
});

describe('the tap landing', () => {
	it('checks the order in, stamped with who sold it, and records the money once', async () => {
		const result = await startDoorSale({
			eventId: 'tonight',
			quantity: 2,
			unitPriceCents: 1500,
			staffUserId: 'staff-1',
			now: NOW
		});
		if (result.kind !== 'card') throw new Error('expected a card sale');
		const paid = completeFakeTerminalPayment(result.paymentIntentId);

		await fulfillDoorSale(paid);
		await fulfillDoorSale(paid); // Stripe redelivers.

		const minted = rows(result.paymentIntentId);
		expect(minted.every((r) => r.status === 'checked_in')).toBe(true);
		expect(minted[0]).toMatchObject({
			checked_in_by_user_id: 'staff-1',
			stripe_payment_record_id: result.paymentIntentId
		});
		expect(recordDoorTicketSale).toHaveBeenCalledTimes(1);
		expect(recordDoorTicketSale).toHaveBeenCalledWith(
			expect.objectContaining({ purchaseId: result.paymentIntentId, chargeCents: 3000 })
		);
		expect(await getDoorSale(result.paymentIntentId)).toEqual({ status: 'paid', quantity: 2 });
	});

	it('ignores an intent that is not a door sale', async () => {
		const other = await stripe.paymentIntents.create({ amount: 500, currency: 'usd' });
		await fulfillDoorSale({ ...other, status: 'succeeded' });
		expect(recordDoorTicketSale).not.toHaveBeenCalled();
	});

	it('cancels an untapped sale, intent and seats together', async () => {
		const result = await startDoorSale({
			eventId: 'tonight',
			quantity: 1,
			unitPriceCents: 1500,
			staffUserId: 'staff-1',
			now: NOW
		});
		if (result.kind !== 'card') throw new Error('expected a card sale');
		expect(await getDoorSale(result.paymentIntentId)).toEqual({ status: 'pending', quantity: 1 });

		await cancelDoorSale(result.paymentIntentId);

		expect((await stripe.paymentIntents.retrieve(result.paymentIntentId)).status).toBe('canceled');
		expect(await getDoorSale(result.paymentIntentId)).toEqual({ status: 'cancelled', quantity: 0 });
	});
});
