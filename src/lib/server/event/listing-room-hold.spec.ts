import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A listing with no production holds the room itself (#2004), against a real
 * SQLite: who the hold is booked to, whether it blocks the room, and whether
 * it follows the listing, are all rows and predicates.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (r: unknown) => {
		const x = r as { meta?: { changes?: number }; changes?: number };
		return Number(x?.meta?.changes ?? x?.changes ?? 0);
	}
}));
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: vi.fn(), on: vi.fn() }
}));
vi.mock('$lib/server/lock/lock-service', () => ({ syncAccessWindow: vi.fn() }));
// Site config reads KV; an empty store is the defaults.
vi.mock('$lib/server/kv', () => ({
	getJson: async () => null,
	putJson: async () => undefined,
	listKeys: async () => [],
	deleteKey: async () => undefined
}));

const events = await import('./event-service');
const { hasConflict } = await import('$lib/server/reservation/conflict-service');
const { notAProgramHold } = await import('$lib/server/reservation/program-hold');
const { eventBookerJoin } = await import('$lib/server/reservation/event-hold');
const { toBookerRef } = await import('$lib/server/entity/refs');
const { reservation } = await import('$lib/server/db/schema/reservation');
const { eventListing } = await import('$lib/server/db/schema/event');
const { db } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');

const STAFF = 'u-staff';
const HOUR = 3_600_000;
// Far enough ahead that no advance-booking window or past-start rule applies.
const T0 = new Date(Date.UTC(2030, 5, 7, 2, 0, 0));
const at = (h: number) => new Date(T0.getTime() + h * HOUR);

function listing(id: string, opts: { kind?: string; productionId?: string } = {}) {
	sqlite
		.prepare(
			`insert into event_listing (id, title, starts_at, ends_at, kind, source, status, production_id, created_by_user_id)
			 values (?, ?, ?, ?, ?, 'cmc', 'draft', ?, ?)`
		)
		.run(
			id,
			`Listing ${id}`,
			Math.floor(at(1).getTime() / 1000),
			Math.floor(at(3).getTime() / 1000),
			opts.kind ?? 'show',
			opts.productionId ?? null,
			STAFF
		);
}

const hold = (eventId: string, from: number, to: number) =>
	events.update(eventId, {
		rebook: {
			userId: STAFF,
			reservationStartsAt: at(from),
			reservationEndsAt: at(to),
			overrideConflicts: false
		}
	});

const reservationOf = (eventId: string) =>
	sqlite
		.prepare(
			`select r.id, r.booker_type, r.booker_id, r.hard_hold, r.status, r.starts_at, r.ends_at
			   from reservation r join event_listing e on e.reservation_id = r.id where e.id = ?`
		)
		.get(eventId) as
		| {
				id: string;
				booker_type: string;
				booker_id: string;
				hard_hold: number;
				status: string;
				starts_at: number;
				ends_at: number;
		  }
		| undefined;

/** A hold already booked to its listing, as the fix writes one. */
function listingHold(eventId: string) {
	listing(eventId);
	const secs = (h: number) => Math.floor(at(h).getTime() / 1000);
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, hard_hold, starts_at, ends_at)
			 values (?, 'event_listing', ?, ?, 'confirmed', 1, ?, ?)`
		)
		.run(`res-${eventId}`, eventId, STAFF, secs(0), secs(4));
	sqlite.exec(`update event_listing set reservation_id = 'res-${eventId}' where id = '${eventId}'`);
}

const productionCount = () =>
	(sqlite.prepare('select count(*) as n from production').get() as { n: number }).n;

beforeEach(() => {
	for (const t of ['reservation', 'event_listing', 'production', 'project', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('${STAFF}', 'Staff', 's@x.test', 0)`
	);
});

describe('holding the room for a listing with no production', () => {
	it('books the reservation to the listing and opens no production', async () => {
		listing('ev-show');

		await hold('ev-show', 0, 4);

		const r = reservationOf('ev-show');
		expect(r).toMatchObject({ booker_type: 'event_listing', booker_id: 'ev-show', hard_hold: 1 });
		expect(productionCount()).toBe(0);
	});

	it('does the same for a workshop with no group running it', async () => {
		listing('ev-class', { kind: 'class' });

		await hold('ev-class', 0, 4);

		expect(reservationOf('ev-class')).toMatchObject({
			booker_type: 'event_listing',
			booker_id: 'ev-class'
		});
		expect(productionCount()).toBe(0);
	});

	it.each(['class', 'show'] as const)(
		'creates a %s with the room held and no production',
		async (kind) => {
			const created = await events.create({
				title: 'Workshop',
				startsAt: at(1),
				endsAt: at(3),
				kind,
				createdByUserId: STAFF,
				reservation: { startsAt: at(0), endsAt: at(4), overrideConflicts: false }
			});

			expect(reservationOf(created.id)).toMatchObject({
				booker_type: 'event_listing',
				booker_id: created.id
			});
			expect(productionCount()).toBe(0);
		}
	);
});

describe('a listing’s hold is an event hold', () => {
	beforeEach(() => listingHold('ev-show'));

	it('hard-blocks the room', async () => {
		expect(await hasConflict(at(1), at(2))).toBe(true);
	});

	it('is not counted as somebody’s own booking', async () => {
		const rows = await db.select({ id: reservation.id }).from(reservation).where(notAProgramHold());
		expect(rows).toEqual([]);
	});

	it('joins to its listing the way a production hold does', async () => {
		const rows = await db
			.select({ id: reservation.id, eventId: eventListing.id })
			.from(reservation)
			.leftJoin(eventListing, eventBookerJoin());
		expect(rows).toEqual([{ id: reservationOf('ev-show')!.id, eventId: 'ev-show' }]);
	});

	it('is shown as held for its listing, not as a member booking', () => {
		const ref = toBookerRef({
			bookerType: 'event_listing',
			member: { id: STAFF, name: 'Staff', email: 's@x.test' } as never,
			event: { id: 'ev-show', title: 'Listing ev-show' }
		});
		expect(ref).toMatchObject({ type: 'event', id: 'ev-show' });
	});
});

describe('the hold follows the listing', () => {
	beforeEach(() => listingHold('ev-show'));

	it('moves when the listing is re-timed', async () => {
		const before = reservationOf('ev-show')!;

		await hold('ev-show', 24, 28);

		const after = reservationOf('ev-show')!;
		expect(after.id).toBe(before.id);
		expect(after.starts_at).toBe(Math.floor(at(24).getTime() / 1000));
		expect(after.ends_at).toBe(Math.floor(at(28).getTime() / 1000));
	});

	it('is released when the listing is cancelled', async () => {
		await events.cancel('ev-show', STAFF);

		expect(reservationOf('ev-show')!.status).toBe('cancelled');
		expect(await hasConflict(at(1), at(2))).toBe(false);
	});
});

describe('a production’s hold', () => {
	it('is still booked to the production', async () => {
		sqlite.exec(`insert into project (id, name, kind) values ('proj-1', 'Friday', 'production')`);
		sqlite.exec(
			`insert into production (id, project_id, status) values ('prod-1', 'proj-1', 'planning')`
		);
		listing('ev-prod', { productionId: 'prod-1' });

		await hold('ev-prod', 0, 4);

		expect(reservationOf('ev-prod')).toMatchObject({
			booker_type: 'production',
			booker_id: 'prod-1',
			hard_hold: 1
		});
		expect(productionCount()).toBe(1);
		const rows = await db
			.select({ eventId: eventListing.id })
			.from(reservation)
			.leftJoin(eventListing, eventBookerJoin())
			.where(eq(reservation.bookerId, 'prod-1'));
		expect(rows).toEqual([{ eventId: 'ev-prod' }]);
	});
});
