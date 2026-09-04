/**
 * The orientation listener against a real database on the real migrated schema.
 *
 * Every claim worth making here is about rows: that a repeated event creates one
 * set of work orders and not two, that a cancelled booking stands its shift
 * down without un-orienting somebody already shown around, and that a band's
 * hold raises nothing. A mocked query builder can express none of those.
 *
 * Same `db.batch` shim as `duty-list-service.spec.ts` — D1 has it, the node
 * driver does not, and awaiting the statements in order is what D1 does anyway
 * minus the atomicity these tests are not about.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');

const sqlite = new DatabaseSync(':memory:');
const base = drizzle({ client: sqlite });

vi.mock('$lib/server/db', () => ({
	db: new Proxy(
		{},
		{
			get(_, prop) {
				if (prop === 'batch') {
					return async (stmts: PromiseLike<unknown>[]) => {
						const out = [];
						for (const s of stmts) out.push(await s);
						return out;
					};
				}
				return Reflect.get(base as object, prop, base);
			}
		}
	),
	getRowCount: () => 0
}));

/** A real emitter would do, but a hand-rolled one keeps the assertions direct. */
const handlers = new Map<string, ((e: { data: unknown }) => Promise<void>)[]>();
vi.mock('$lib/server/event-bus', () => ({
	domainEvents: {
		on(name: string, fn: (e: { data: unknown }) => Promise<void>) {
			handlers.set(name, [...(handlers.get(name) ?? []), fn]);
		},
		emit: vi.fn()
	}
}));
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { on: vi.fn(), emit: vi.fn() }
}));

async function fire(name: string, data: unknown) {
	for (const fn of handlers.get(name) ?? []) await fn({ data });
}

const STARTS = Math.floor(new Date('2026-10-10T03:00:00Z').getTime() / 1000);
const ENDS = Math.floor(new Date('2026-10-10T05:00:00Z').getTime() / 1000);

let getOrientation: typeof import('./orientation-service').getOrientation;
let applyDutyList: typeof import('./duty-list-service').applyDutyList;

beforeAll(async () => {
	migrate(base, { migrationsFolder: MIGRATIONS_FOLDER });
	const { registerOrientationListeners } = await import('./orientation-listener');
	({ getOrientation } = await import('./orientation-service'));
	({ applyDutyList } = await import('./duty-list-service'));
	registerOrientationListeners();
}, 30_000);

function createdEvent(over: Record<string, unknown> = {}) {
	return {
		reservationId: 'res-1',
		userId: 'u-member',
		userName: 'Ada',
		userEmail: 'ada@example.test',
		date: '10 Oct',
		startTime: '8:00 PM',
		endTime: '10:00 PM',
		bookerType: 'user',
		startsAt: new Date(STARTS * 1000).toISOString(),
		endsAt: new Date(ENDS * 1000).toISOString(),
		createdByStaffId: null,
		recurringSeriesId: null,
		...over
	};
}

function shifts() {
	return sqlite
		.prepare(`SELECT id, starts_at, reservation_id, cancelled_at FROM work_order`)
		.all() as {
		id: string;
		starts_at: number | null;
		reservation_id: string | null;
		cancelled_at: number | null;
	}[];
}

beforeEach(() => {
	for (const t of [
		'member_orientation',
		'work_task',
		'work_order',
		'duty_list_item',
		'duty_list',
		'reservation'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.exec(`DELETE FROM volunteer_role WHERE id = 'role-orient'`);
	sqlite.exec(`DELETE FROM user WHERE id IN ('u-member','u-vol')`);

	sqlite.exec(
		`INSERT INTO user (id, name, email, email_verified) VALUES
		 ('u-member','Ada','ada@example.test',1),
		 ('u-vol','Sam','sam@example.test',1)`
	);
	sqlite.exec(
		`INSERT INTO volunteer_role (id, name) VALUES ('role-orient','Rehearsal Orientation')`
	);
	sqlite.exec(
		`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
		 VALUES ('res-1','user','u-member','u-member','scheduled', ${STARTS}, ${ENDS})`
	);
});

/** The list staff would have made. Absent in tests that assert the feature is off. */
function seedList() {
	sqlite.exec(
		`INSERT INTO duty_list (id, name, anchor, subject, auto_apply_on)
		 VALUES ('dl-orient','Rehearsal Orientation','start','reservation','reservation.first')`
	);
	sqlite.exec(
		`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, offset_minutes, duration_minutes, tasks)
		 VALUES ('dli-1','dl-orient','role-orient', -15, 45, '["Meet them at the door"]')`
	);
}

describe('reservation.created', () => {
	it('raises an orientation shift for a first booking and points the member at it', async () => {
		seedList();

		await fire('reservation.created', createdEvent());

		const rows = shifts();
		expect(rows).toHaveLength(1);
		expect(rows[0].starts_at).toBe(STARTS - 15 * 60);
		expect(rows[0].reservation_id).toBe('res-1');

		const orientation = await getOrientation('u-member', new Date(STARTS * 1000 - 86_400_000));
		expect(orientation?.state).toBe('scheduled');
		expect(orientation?.workOrderId).toBe(rows[0].id);
	});

	it('creates one set of work orders when the same event is delivered twice', async () => {
		seedList();

		await fire('reservation.created', createdEvent());
		await fire('reservation.created', createdEvent());

		// The bus has no dedupe; `applyDutyList`'s re-apply guard is the dedupe.
		expect(shifts()).toHaveLength(1);
	});

	it('does nothing for a band hold — that is not somebody’s first visit', async () => {
		seedList();
		sqlite.exec(`UPDATE reservation SET booker_type = 'group' WHERE id = 'res-1'`);

		await fire('reservation.created', createdEvent({ bookerType: 'group' }));

		expect(shifts()).toHaveLength(0);
	});

	it('does nothing on a second booking', async () => {
		seedList();
		sqlite.exec(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 VALUES ('res-0','user','u-member','u-member','completed', ${STARTS - 86400}, ${ENDS - 86400})`
		);

		await fire('reservation.created', createdEvent());

		expect(shifts()).toHaveLength(0);
	});

	it('ignores a stale waitlisted row when deciding whether this is the first', async () => {
		// The defect this shares with `isFirstReservationSql`: a queue position is
		// not a visit, and counting one would silently suppress the orientation.
		seedList();
		sqlite.exec(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 VALUES ('res-w','user','u-member','u-member','waitlisted', ${STARTS - 86400}, ${ENDS - 86400})`
		);

		await fire('reservation.created', createdEvent());

		expect(shifts()).toHaveLength(1);
	});

	it('does nothing at all when staff have not made an orientation list', async () => {
		await fire('reservation.created', createdEvent());

		expect(shifts()).toHaveLength(0);
	});

	it('ignores a list that has been archived', async () => {
		seedList();
		sqlite.exec(`UPDATE duty_list SET is_active = 0 WHERE id = 'dl-orient'`);

		await fire('reservation.created', createdEvent());

		expect(shifts()).toHaveLength(0);
	});
});

/**
 * A booking that came off the waitlist announces itself at the moment it stops
 * being a queue position — `announceWaitlistConfirmed()`, from the member's own
 * confirmation, not from `promoteNextWaitlisted()`, which only offers the slot.
 * By the time the event lands the row is `scheduled`, so from here it is an
 * ordinary `reservation.created` — and that is the point. What these cover is
 * what the *rest of the queue* does to the first-booking rule, which is where
 * `priorBookingCount` excluding `waitlisted` rows starts to matter.
 */
describe('a booking confirmed off the waitlist', () => {
	it('raises an orientation even though the member has been queueing for weeks', async () => {
		seedList();
		// Still in the queue, and earlier: excluded from `priorBookingCount`, so it
		// must not make the booking they actually got look like a second visit.
		sqlite.exec(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 VALUES ('res-q','user','u-member','u-member','waitlisted', ${STARTS - 86400}, ${ENDS - 86400})`
		);

		await fire('reservation.created', createdEvent());

		const rows = shifts();
		expect(rows).toHaveLength(1);
		expect(rows[0].reservation_id).toBe('res-1');
		expect((await getOrientation('u-member', new Date(STARTS * 1000 - 86_400_000)))?.state).toBe(
			'scheduled'
		);
	});

	it('gives the second confirmation nothing, because the first is now history', async () => {
		seedList();
		// Two queued bookings, and the earlier one comes off the waitlist first.
		sqlite.exec(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 VALUES ('res-q','user','u-member','u-member','waitlisted', ${STARTS - 86400}, ${ENDS - 86400})`
		);
		sqlite.exec(`UPDATE reservation SET status = 'scheduled' WHERE id = 'res-q'`);

		await fire(
			'reservation.created',
			createdEvent({
				reservationId: 'res-q',
				startsAt: new Date((STARTS - 86400) * 1000).toISOString(),
				endsAt: new Date((ENDS - 86400) * 1000).toISOString()
			})
		);

		// That transition is what makes `res-q` visible to `priorBookingCount` at
		// all — while it sat in the queue it counted for nothing.
		await fire('reservation.created', createdEvent());

		const rows = shifts();
		expect(rows).toHaveLength(1);
		expect(rows[0].reservation_id).toBe('res-q');
	});

	it('does not add a second shift to a booking staff already stamped by hand', async () => {
		seedList();
		// The workaround for the gap this closes: a coordinator applied the
		// orientation list to the queued booking themselves. The confirmation must
		// land on the re-apply guard, not double the roster.
		await applyDutyList('dl-orient', { kind: 'reservation', id: 'res-1' }, null);

		await fire('reservation.created', createdEvent());

		expect(shifts()).toHaveLength(1);
	});
});

describe('reservation.cancelled', () => {
	function cancelledEvent(reservationId = 'res-1') {
		return {
			reservationId,
			userId: 'u-member',
			userName: 'Ada',
			userEmail: 'ada@example.test',
			date: '10 Oct',
			startTime: '8:00 PM',
			endTime: '10:00 PM',
			cancelledBy: 'member' as const
		};
	}

	it('stands the shift down and drops the member back to pending', async () => {
		seedList();
		await fire('reservation.created', createdEvent());

		await fire('reservation.cancelled', cancelledEvent());

		expect(shifts()[0].cancelled_at).not.toBeNull();
		const orientation = await getOrientation('u-member');
		expect(orientation?.workOrderId).toBeNull();
		expect(orientation?.state).toBe('pending');
	});

	it('leaves a completed orientation alone', async () => {
		seedList();
		await fire('reservation.created', createdEvent());
		sqlite.exec(`UPDATE member_orientation SET completed_at = unixepoch()`);

		await fire('reservation.cancelled', cancelledEvent());

		// The shift is still called off — it is not happening — but cancelling a
		// booking must never un-orient somebody already shown around.
		expect(shifts()[0].cancelled_at).not.toBeNull();
		expect((await getOrientation('u-member'))?.state).toBe('completed');
	});

	it('gives a rebooking a fresh orientation and keeps the cancelled one as a record', async () => {
		seedList();
		await fire('reservation.created', createdEvent());
		await fire('reservation.cancelled', cancelledEvent());

		sqlite.exec(`UPDATE reservation SET status = 'cancelled' WHERE id = 'res-1'`);
		sqlite.exec(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 VALUES ('res-2','user','u-member','u-member','scheduled', ${STARTS + 86400}, ${ENDS + 86400})`
		);

		await fire(
			'reservation.created',
			createdEvent({
				reservationId: 'res-2',
				startsAt: new Date((STARTS + 86400) * 1000).toISOString(),
				endsAt: new Date((ENDS + 86400) * 1000).toISOString()
			})
		);

		const rows = shifts();
		expect(rows).toHaveLength(2);
		expect(rows.filter((r) => r.cancelled_at === null)).toHaveLength(1);

		// One row per member, repointed rather than appended to.
		const [{ n }] = sqlite.prepare(`SELECT count(*) AS n FROM member_orientation`).all() as {
			n: number;
		}[];
		expect(n).toBe(1);
	});

	it('is a no-op for a booking that never had one', async () => {
		await expect(fire('reservation.cancelled', cancelledEvent('res-1'))).resolves.toBeUndefined();
	});
});
