import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Tickets against a real SQLite: which rows a purchase flips, cancels or counts
// is a `WHERE` on status, and the money is summed in SQL.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const {
	generateCodeString,
	createTickets,
	fulfillPurchase,
	cancelPurchase,
	cancelStalePendingTickets,
	cancelTicket,
	checkIn,
	getTicketsSold,
	getTicketsRemaining,
	getTicketsByPurchase,
	getEventTickets,
	getEventTicketMoney,
	getUserTickets,
	TicketNotFoundError,
	TicketStateError
} = await import('./ticket-service');

const NOW = new Date('2026-06-15T12:00:00Z');
const NOW_S = NOW.getTime() / 1000;
const HOUR = 3600;

let seq = 0;
function ticket(
	id: string,
	opts: {
		eventId?: string;
		purchaseId?: string;
		userId?: string;
		status?: string;
		createdAt?: number;
		checkedInAt?: number;
		unit?: number;
		contribution?: number;
		acts?: number;
		collective?: number;
		feeCovered?: number;
		name?: string;
	} = {}
) {
	sqlite
		.prepare(
			`insert into ticket (id, event_id, purchase_id, user_id, attendee_name, attendee_email, code, status,
			   unit_price_cents, contribution_cents, acts_cents, collective_cents, fee_covered_cents, checked_in_at, created_at, updated_at)
			 values (?, ?, ?, ?, ?, 'a@example.com', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.eventId ?? 'event-1',
			opts.purchaseId ?? 'purchase-1',
			opts.userId ?? null,
			opts.name ?? 'Alice',
			`CODE${String(++seq).padStart(4, '0')}`,
			opts.status ?? 'valid',
			opts.unit ?? 0,
			opts.contribution ?? 0,
			opts.acts ?? 0,
			opts.collective ?? 0,
			opts.feeCovered ?? 0,
			opts.checkedInAt ?? null,
			opts.createdAt ?? NOW_S - HOUR,
			opts.createdAt ?? NOW_S - HOUR
		);
}

function event(id: string, startsAt: number, title = id) {
	sqlite
		.prepare(
			`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id) values (?, ?, ?, ?, 'user-x')`
		)
		.run(id, title, startsAt, startsAt + 3 * HOUR);
}

type Row = {
	id: string;
	status: string;
	stripe_payment_record_id: string | null;
	checked_in_by_user_id: string | null;
	checked_in_at: number | null;
};
const row = (id: string) => sqlite.prepare('select * from ticket where id = ?').get(id) as Row;
const statuses = () =>
	Object.fromEntries(
		(sqlite.prepare('select id, status from ticket').all() as Row[]).map((r) => [r.id, r.status])
	);

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	seq = 0;
	for (const t of ['ticket', 'ticket_sale', 'event_listing', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
});

afterEach(() => {
	vi.useRealTimers();
});

describe('generateCodeString', () => {
	it('returns an 8-character string', () => {
		expect(generateCodeString()).toHaveLength(8);
	});

	it('uses only uppercase letters and digits, without the ambiguous ones', () => {
		for (let i = 0; i < 100; i++) {
			expect(generateCodeString()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
		}
	});
});

describe('createTickets', () => {
	const base = {
		eventId: 'event-1',
		purchaseId: 'purchase-1',
		attendeeName: 'Alice',
		attendeeEmail: 'alice@example.com'
	};

	it('inserts one row per ticket, each with its own code', async () => {
		const result = await createTickets({ ...base, quantity: 2, userId: 'user-1' });

		expect(result).toHaveLength(2);
		expect(new Set(result.map((t) => t.code)).size).toBe(2);
		expect(
			sqlite.prepare("select count(*) as n from ticket where user_id = 'user-1'").get()
		).toEqual({ n: 2 });
	});

	it('records what each pass cost and whether the discount was waived', async () => {
		const result = await createTickets({
			...base,
			quantity: 2,
			unitPriceCents: 750,
			discountWaived: true
		});

		for (const t of result) expect(t).toMatchObject({ unitPriceCents: 750, discountWaived: true });
	});

	// The gift belongs to the purchase. Copying it onto each pass would multiply
	// it by the quantity for anyone summing a purchase.
	it('records the order contribution on one ticket, not on every ticket', async () => {
		await createTickets({ ...base, quantity: 3, unitPriceCents: 1500, contributionCents: 1000 });

		expect(
			sqlite
				.prepare("select sum(contribution_cents) as s from ticket where purchase_id = 'purchase-1'")
				.get()
		).toEqual({ s: 1000 });
	});

	it('defaults the money fields to zero for comps and free claims', async () => {
		const [t] = await createTickets({
			...base,
			purchaseId: 'comp-1',
			quantity: 1,
			status: 'valid'
		});

		expect(t).toMatchObject({ unitPriceCents: 0, contributionCents: 0, discountWaived: false });
	});

	it('creates tickets with pending status by default', async () => {
		const [t] = await createTickets({ ...base, quantity: 1 });
		expect(row(t.id).status).toBe('pending');
		expect(t.userId).toBeNull();
	});

	it('creates tickets with valid status when specified', async () => {
		const [t] = await createTickets({ ...base, quantity: 1, status: 'valid' });
		expect(row(t.id).status).toBe('valid');
	});
});

describe('fulfillPurchase', () => {
	it("flips only that purchase's pending tickets and returns them", async () => {
		ticket('t1', { status: 'pending' });
		ticket('t2', { status: 'pending' });
		ticket('t3', { status: 'cancelled' });
		ticket('t4', { status: 'pending', purchaseId: 'purchase-2' });

		const rows = await fulfillPurchase('purchase-1');

		expect(rows.map((r) => r.id).sort()).toEqual(['t1', 't2']);
		expect(statuses()).toEqual({ t1: 'valid', t2: 'valid', t3: 'cancelled', t4: 'pending' });
	});

	it('returns empty array when no pending tickets exist', async () => {
		ticket('t1', { status: 'valid' });
		expect(await fulfillPurchase('purchase-1')).toHaveLength(0);
	});

	it('writes the payment record id in the same update as the status flip', async () => {
		ticket('t1', { status: 'pending' });

		await fulfillPurchase('purchase-1', 'pi_abc123');

		expect(row('t1')).toMatchObject({ status: 'valid', stripe_payment_record_id: 'pi_abc123' });
	});

	it('leaves the payment record id unset for purchases that never touch Stripe', async () => {
		ticket('t1', { status: 'pending', purchaseId: 'comp-1' });

		await fulfillPurchase('comp-1');

		expect(row('t1')).toMatchObject({ status: 'valid', stripe_payment_record_id: null });
	});
});

describe('cancelPurchase', () => {
	it('cancels the pending and valid tickets of that purchase and counts them', async () => {
		ticket('t1', { status: 'pending' });
		ticket('t2', { status: 'valid' });
		ticket('t3', { status: 'checked_in' });
		ticket('t4', { status: 'valid', purchaseId: 'purchase-2' });

		expect(await cancelPurchase('purchase-1')).toBe(2);
		expect(statuses()).toEqual({
			t1: 'cancelled',
			t2: 'cancelled',
			t3: 'checked_in',
			t4: 'valid'
		});
	});
});

describe('cancelStalePendingTickets', () => {
	it('cancels only pending tickets older than the cutoff', async () => {
		ticket('stale', { status: 'pending', createdAt: NOW_S - 25 * HOUR });
		ticket('fresh', { status: 'pending', createdAt: NOW_S - 23 * HOUR });
		ticket('paid', { status: 'valid', createdAt: NOW_S - 48 * HOUR });

		expect(await cancelStalePendingTickets(24)).toBe(1);
		expect(statuses()).toEqual({ stale: 'cancelled', fresh: 'pending', paid: 'valid' });
	});
});

describe('checkIn', () => {
	it('throws when ticket not found', async () => {
		await expect(checkIn('nonexistent', 'staff-1')).rejects.toThrow(TicketNotFoundError);
	});

	it('throws when ticket is not valid', async () => {
		ticket('t1', { status: 'pending' });
		await expect(checkIn('t1', 'staff-1')).rejects.toThrow(TicketStateError);
	});

	// Idempotent since #933: two volunteers on two phones work one queue. The
	// first check-in's time comes back so the UI can say when they came in.
	it('reports an already-checked-in ticket instead of throwing', async () => {
		const at = NOW_S - HOUR;
		ticket('t1', { status: 'checked_in', checkedInAt: at });

		await expect(checkIn('t1', 'staff-2')).resolves.toEqual({
			alreadyIn: true,
			checkedInAt: new Date(at * 1000)
		});
		expect(row('t1').checked_in_by_user_id).toBeNull();
	});

	it('does not crash on a checked-in ticket with no recorded time', async () => {
		ticket('t1', { status: 'checked_in' });
		await expect(checkIn('t1', 'staff-1')).resolves.toMatchObject({ alreadyIn: true });
	});

	it('throws when ticket is cancelled', async () => {
		ticket('t1', { status: 'cancelled' });
		await expect(checkIn('t1', 'staff-1')).rejects.toThrow(TicketStateError);
	});

	it('checks in a valid ticket, and says it was this scan', async () => {
		ticket('t1', { status: 'valid' });
		ticket('t2', { status: 'valid' });

		await expect(checkIn('t1', 'staff-1')).resolves.toEqual({ alreadyIn: false, checkedInAt: NOW });
		expect(row('t1')).toMatchObject({
			status: 'checked_in',
			checked_in_by_user_id: 'staff-1',
			checked_in_at: NOW_S
		});
		expect(row('t2').status).toBe('valid');
	});
});

describe('getTicketsSold', () => {
	it('counts valid and checked-in tickets for that event only', async () => {
		ticket('a', { status: 'valid' });
		ticket('b', { status: 'checked_in' });
		ticket('c', { status: 'pending' });
		ticket('d', { status: 'cancelled' });
		ticket('e', { status: 'valid', eventId: 'event-2' });

		expect(await getTicketsSold('event-1')).toBe(2);
	});

	it('returns 0 when nothing has sold', async () => {
		expect(await getTicketsSold('event-1')).toBe(0);
	});
});

describe('getTicketsRemaining', () => {
	const sale = (quantity: number | null) =>
		sqlite
			.prepare(`insert into ticket_sale (event_listing_id, quantity) values ('event-1', ?)`)
			.run(quantity);

	it('returns null for unlimited capacity', async () => {
		sale(null);
		expect(await getTicketsRemaining('event-1')).toBeNull();
	});

	it('returns null when the event has no sale', async () => {
		expect(await getTicketsRemaining('event-1')).toBeNull();
	});

	it('returns remaining count for limited capacity', async () => {
		sale(50);
		for (let i = 0; i < 12; i++) ticket(`t${i}`);
		ticket('pending', { status: 'pending' });
		expect(await getTicketsRemaining('event-1')).toBe(38);
	});

	it('returns 0 when sold out', async () => {
		sale(2);
		ticket('a');
		ticket('b');
		expect(await getTicketsRemaining('event-1')).toBe(0);
	});

	it('returns 0 when oversold', async () => {
		sale(1);
		ticket('a');
		ticket('b');
		expect(await getTicketsRemaining('event-1')).toBe(0);
	});
});

describe('cancelTicket', () => {
	it('throws when ticket not found', async () => {
		await expect(cancelTicket('nonexistent')).rejects.toThrow(TicketNotFoundError);
	});

	it('throws when ticket is already cancelled', async () => {
		ticket('t1', { status: 'cancelled' });
		await expect(cancelTicket('t1')).rejects.toThrow(TicketStateError);
	});

	it('throws when ticket is already checked in', async () => {
		ticket('t1', { status: 'checked_in' });
		await expect(cancelTicket('t1')).rejects.toThrow(TicketStateError);
		expect(row('t1').status).toBe('checked_in');
	});

	it('cancels a pending ticket, and only that one', async () => {
		ticket('t1', { status: 'pending' });
		ticket('t2', { status: 'pending' });
		await cancelTicket('t1');
		expect(statuses()).toEqual({ t1: 'cancelled', t2: 'pending' });
	});

	it('cancels a valid ticket', async () => {
		ticket('t1', { status: 'valid' });
		await cancelTicket('t1');
		expect(row('t1').status).toBe('cancelled');
	});
});

describe('getTicketsByPurchase', () => {
	it("returns that purchase's tickets", async () => {
		ticket('t1');
		ticket('t2');
		ticket('t3', { purchaseId: 'purchase-2' });

		expect((await getTicketsByPurchase('purchase-1')).map((t) => t.id)).toEqual(['t1', 't2']);
	});

	it('returns empty array when no tickets found', async () => {
		expect(await getTicketsByPurchase('purchase-nonexistent')).toEqual([]);
	});
});

describe('getEventTickets', () => {
	beforeEach(() => {
		ticket('v', { status: 'valid', name: 'Ann' });
		ticket('c', { status: 'checked_in', name: 'Bea' });
		ticket('x', { status: 'cancelled', name: 'Cal' });
		ticket('other', { eventId: 'event-2' });
	});

	it('returns every ticket for the event without a status filter', async () => {
		expect((await getEventTickets('event-1')).map((t) => t.id)).toEqual(['v', 'c', 'x']);
	});

	it('narrows to the statuses asked for', async () => {
		expect((await getEventTickets('event-1', ['valid', 'checked_in'])).map((t) => t.id)).toEqual([
			'v',
			'c'
		]);
	});

	it('treats an empty status filter as no filter', async () => {
		expect(await getEventTickets('event-1', [])).toHaveLength(3);
	});

	it('names who checked a ticket in', async () => {
		sqlite.exec(`insert into user (id, name, email) values ('staff-1', 'Sam', 'sam@example.com')`);
		sqlite.exec(`update ticket set checked_in_by_user_id = 'staff-1' where id = 'c'`);

		const rows = await getEventTickets('event-1');
		expect(rows.find((t) => t.id === 'c')?.checkedInByName).toBe('Sam');
	});
});

describe('getUserTickets', () => {
	it("returns the user's paid tickets with their event, newest show first", async () => {
		event('event-1', NOW_S + 24 * HOUR, 'Concert');
		event('event-2', NOW_S + 48 * HOUR, 'Later');
		ticket('a', { userId: 'user-1', status: 'valid' });
		ticket('b', { userId: 'user-1', status: 'checked_in', eventId: 'event-2' });
		ticket('p', { userId: 'user-1', status: 'pending' });
		ticket('x', { userId: 'user-1', status: 'cancelled' });
		ticket('o', { userId: 'user-2', status: 'valid' });

		const result = await getUserTickets('user-1');

		expect(result.map((t) => [t.id, t.eventTitle])).toEqual([
			['b', 'Later'],
			['a', 'Concert']
		]);
	});

	it('returns empty array when user has no tickets', async () => {
		expect(await getUserTickets('user-nonexistent')).toEqual([]);
	});
});

describe('getEventTicketMoney', () => {
	// A cancelled ticket's money is not the show's money, and a `pending` one is
	// a checkout nobody finished.
	it('sums only the tickets that are actually good for entry', async () => {
		ticket('a', { unit: 1500, contribution: 500, acts: 1600, collective: 400 });
		ticket('b', { status: 'checked_in', unit: 1500 });
		ticket('free', { status: 'valid' });
		ticket('x', { status: 'cancelled', unit: 9999, acts: 9999 });
		ticket('p', { status: 'pending', unit: 9999 });
		ticket('other', { eventId: 'event-2', unit: 9999 });

		expect(await getEventTicketMoney('event-1')).toEqual({
			ticketsCents: 3000,
			contributionsCents: 500,
			actsCents: 1600,
			collectiveCents: 400,
			feeCoveredCents: 0,
			freeCount: 1,
			paidCount: 2
		});
	});

	// SQLite `sum()` over no rows is NULL, and a null cent figure rendered into a
	// staff total reads as a missing number rather than as none.
	it('reports zeros rather than nulls for a show that has sold nothing', async () => {
		expect(await getEventTicketMoney('event-1')).toEqual({
			ticketsCents: 0,
			contributionsCents: 0,
			actsCents: 0,
			collectiveCents: 0,
			feeCoveredCents: 0,
			freeCount: 0,
			paidCount: 0
		});
	});
});
