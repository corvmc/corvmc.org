import { describe, it, expect, beforeEach, vi } from 'vitest';

// Guests per act (#3274), against a real SQLite: capacity, the show a credit is
// on and which tickets count as guests are all `WHERE` clauses.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
const recordAuditEntry = vi.fn(async () => undefined);
vi.mock('#lib/server/audit/audit-service.js', () => ({
	recordAuditEntry: (...a: unknown[]) => recordAuditEntry(...(a as []))
}));
const emitTicketPurchased = vi.fn(async () => undefined);
vi.mock('./purchased-event', () => ({
	emitTicketPurchased: (...a: unknown[]) => emitTicketPurchased(...(a as []))
}));

const { addGuest, removeGuest, listGuestsByAct, eventOfAct, eventOfGuest } =
	await import('./guest-service');

const tickets = () =>
	sqlite
		.prepare(
			'select id, status, event_band_id as band, attendee_name as name, purchase_id as purchase from ticket order by attendee_name'
		)
		.all() as { id: string; status: string; band: string | null; name: string; purchase: string }[];

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['ticket', 'ticket_sale', 'event_band', 'event_listing', '"user"'])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec(
		`insert into "user" (id, name, email, email_verified) values ('u1', 'U', 'u@x.org', 1)`
	);
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, created_by_user_id) values
		 ('evt-1', 'Show', 1000000, 2000000, 'published', 'cmc', 'u1'),
		 ('evt-x', 'Called off', 1000000, 2000000, 'cancelled', 'cmc', 'u1')`
	);
	sqlite.exec(
		`insert into event_band (id, event_id, name, billing_order, status) values
		 ('act-a', 'evt-1', 'Alpha', 0, 'unlinked'),
		 ('act-x', 'evt-x', 'Xylo', 0, 'unlinked')`
	);
});

describe('addGuest', () => {
	it('issues a valid one-seat ticket tied to the act, emails it and records the comp', async () => {
		await addGuest({ eventBandId: 'act-a', name: 'Rowan', email: 'r@x.org' });

		const [row] = tickets();
		expect(row).toMatchObject({ status: 'valid', band: 'act-a', name: 'Rowan' });
		expect(row.purchase).toMatch(/^comp-/);
		expect(emitTicketPurchased).toHaveBeenCalledOnce();
		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'event.tickets_comped' })
		);
	});

	it('counts against the sale capacity and refuses past it', async () => {
		sqlite.exec(
			`insert into ticket_sale (id, event_listing_id, enabled, quantity) values ('s1', 'evt-1', 1, 1)`
		);
		await addGuest({ eventBandId: 'act-a', name: 'First', email: 'f@x.org' });

		await expect(
			addGuest({ eventBandId: 'act-a', name: 'Second', email: 's@x.org' })
		).rejects.toMatchObject({ httpStatus: 409 });
		expect(tickets()).toHaveLength(1);
	});

	it('refuses an act on a cancelled show and an act that is not on a bill', async () => {
		await expect(
			addGuest({ eventBandId: 'act-x', name: 'Late', email: 'l@x.org' })
		).rejects.toMatchObject({ httpStatus: 409 });
		await expect(
			addGuest({ eventBandId: 'nope', name: 'Lost', email: 'l@x.org' })
		).rejects.toMatchObject({ httpStatus: 409 });
		expect(tickets()).toHaveLength(0);
	});
});

describe('removeGuest', () => {
	it("cancels a guest's ticket, sending nothing", async () => {
		await addGuest({ eventBandId: 'act-a', name: 'Rowan', email: 'r@x.org' });
		emitTicketPurchased.mockClear();
		const [guest] = tickets();

		await removeGuest(guest.id);

		expect(tickets()[0].status).toBe('cancelled');
		expect(emitTicketPurchased).not.toHaveBeenCalled();
	});

	it('refuses a ticket that is not a guest’s', async () => {
		sqlite.exec(
			`insert into ticket (id, event_id, purchase_id, attendee_name, attendee_email, code, status)
			 values ('plain', 'evt-1', 'p1', 'Buyer', 'b@x.org', 'CODEPLAIN', 'valid')`
		);

		await expect(removeGuest('plain')).rejects.toMatchObject({ httpStatus: 404 });
		expect(tickets()[0].status).toBe('valid');
	});
});

describe('reads', () => {
	it('lists live guests only, and reads the show from the row', async () => {
		await addGuest({ eventBandId: 'act-a', name: 'Rowan', email: 'r@x.org' });
		await addGuest({ eventBandId: 'act-a', name: 'Mika', email: 'm@x.org' });
		sqlite.exec(
			`insert into ticket (id, event_id, purchase_id, attendee_name, attendee_email, code, status)
			 values ('plain', 'evt-1', 'p1', 'Buyer', 'b@x.org', 'CODEPLAIN', 'valid')`
		);
		const mika = tickets().find((t) => t.name === 'Mika')!;
		await removeGuest(mika.id);

		const guests = await listGuestsByAct('evt-1');
		expect(guests.map((g) => g.name)).toEqual(['Rowan']);
		expect(await eventOfAct('act-a')).toBe('evt-1');
		expect(await eventOfAct('nope')).toBeNull();
		expect(await eventOfGuest(mika.id)).toBe('evt-1');
		expect(await eventOfGuest('plain')).toBeNull();
	});
});
