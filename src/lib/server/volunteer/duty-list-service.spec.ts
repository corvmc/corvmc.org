/**
 * `applyDutyList` against a real database on the real migrated schema.
 *
 * The arithmetic is the point. An item says "3 hours before doors" and the row
 * it produces has to land on an actual instant, in the right column — `startsAt`
 * for a windowed item, `dueAt` for a deadline one — and a mocked query builder
 * cannot tell you whether it did. Nor can it tell you whether the CHECKs accept
 * what the service writes, which is the other half of the risk.
 *
 * The shim below is the whole trick: `db.batch` is a D1 method and the node
 * driver has no such thing, so it is supplied by awaiting the statements in
 * order. That is what D1 does with a batch anyway, minus the atomicity — and
 * atomicity is not what these tests are about.
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

const DOORS = Math.floor(new Date('2026-10-10T02:00:00Z').getTime() / 1000);
const STARTS = Math.floor(new Date('2026-10-10T03:00:00Z').getTime() / 1000);
const ENDS = Math.floor(new Date('2026-10-10T07:00:00Z').getTime() / 1000);

let applyDutyList: typeof import('./duty-list-service').applyDutyList;
let DutyListAlreadyAppliedError: typeof import('./duty-list-service').DutyListAlreadyAppliedError;
let DutyListValidationError: typeof import('./duty-list-service').DutyListValidationError;

beforeAll(async () => {
	migrate(base, { migrationsFolder: MIGRATIONS_FOLDER });
	({ applyDutyList, DutyListAlreadyAppliedError, DutyListValidationError } =
		await import('./duty-list-service'));
}, 30_000);

/** Fresh fixtures per test — every one of these applies a list and asserts on the rows. */
beforeEach(() => {
	for (const t of [
		'work_task',
		'work_order',
		'duty_list_item',
		'duty_list',
		'event',
		'reservation'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.exec(`DELETE FROM volunteer_role WHERE id LIKE 'role-%'`);
	sqlite.exec(`DELETE FROM user WHERE id = 'u1'`);

	sqlite.exec(
		`INSERT INTO user (id, name, email, email_verified) VALUES ('u1','Coord','c@example.com',1)`
	);
	sqlite.exec(`INSERT INTO volunteer_role (id, name) VALUES ('role-1','Front Desk')`);
	sqlite.exec(`INSERT INTO volunteer_role (id, name) VALUES ('role-2','Booking Lead')`);
	sqlite.exec(
		`INSERT INTO event (id, title, starts_at, ends_at, doors_at, created_by_user_id)
		 VALUES ('evt-1','Show', ${STARTS}, ${ENDS}, ${DOORS}, 'u1')`
	);
	sqlite.exec(
		`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
		 VALUES ('res-1','user','u1','u1','scheduled', ${STARTS}, ${ENDS})`
	);
	sqlite.exec(`INSERT INTO duty_list (id, name, anchor) VALUES ('dl-1','Standard Show','doors')`);
	// The orientation shape: anchored to the booking's own start, because a
	// rehearsal has no doors.
	sqlite.exec(
		`INSERT INTO duty_list (id, name, anchor, subject, auto_apply_on)
		 VALUES ('dl-res','Rehearsal Orientation','start','reservation','reservation.first')`
	);
});

function addItem(id: string, cols: string, vals: string) {
	sqlite.exec(
		`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, ${cols})
		 VALUES ('${id}','dl-1','role-1', ${vals})`
	);
}

function shifts() {
	return sqlite
		.prepare(
			`SELECT id, starts_at, ends_at, due_at, capacity, duty_list_id
			 FROM work_order ORDER BY coalesce(starts_at, due_at)`
		)
		.all() as {
		id: string;
		starts_at: number | null;
		ends_at: number | null;
		due_at: number | null;
		capacity: number;
		duty_list_id: string | null;
	}[];
}

describe('applyDutyList', () => {
	it('turns a windowed item into a scheduled shift, measured from doors', async () => {
		addItem('i1', 'offset_minutes, duration_minutes, capacity', '-180, 120, 2');

		await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');

		const [row] = shifts();
		expect(row.starts_at).toBe(DOORS - 180 * 60);
		expect(row.ends_at).toBe(DOORS - 60 * 60);
		expect(row.due_at).toBeNull();
		expect(row.capacity).toBe(2);
		expect(row.duty_list_id).toBe('dl-1');
	});

	it('turns a deadline item into an unscheduled work order with a due date', async () => {
		addItem('i1', 'due_offset_minutes', '-10080');

		await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');

		const [row] = shifts();
		// The whole reason the columns are nullable: this is work with a deadline
		// and no window, and it must not look like a shift anyone is "on".
		expect(row.starts_at).toBeNull();
		expect(row.ends_at).toBeNull();
		expect(row.due_at).toBe(DOORS - 10080 * 60);
	});

	it('falls back to the start time when the event has no doors', async () => {
		sqlite.exec(`UPDATE event SET doors_at = NULL WHERE id = 'evt-1'`);
		addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

		await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');

		expect(shifts()[0].starts_at).toBe(STARTS);
	});

	it('refuses an end-anchored list on an event with no end time, by name', async () => {
		sqlite.exec(`UPDATE duty_list SET anchor = 'end' WHERE id = 'dl-1'`);
		// `event_cmc_needs_end` forbids a CMC event without an end, so the only
		// events that can reach this branch are the ones somebody else authored.
		sqlite.exec(`UPDATE event SET ends_at = NULL, source = 'band' WHERE id = 'evt-1'`);
		addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

		await expect(applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1')).rejects.toThrow(
			/no end time/i
		);
	});

	it('refuses a second apply rather than doubling the roster', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '-180, 120');

		await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');
		await expect(applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1')).rejects.toThrow(
			DutyListAlreadyAppliedError
		);
		expect(shifts()).toHaveLength(1);
	});

	it('lets a re-apply through once the first round is cancelled', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '-180, 120');

		await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');
		sqlite.exec(`UPDATE work_order SET cancelled_at = unixepoch()`);

		await expect(applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1')).resolves.toBeTruthy();
		expect(shifts()).toHaveLength(2);
	});

	it('writes each item’s tasks against its own work order, in order', async () => {
		addItem('i1', 'offset_minutes, duration_minutes, tasks', `-180, 120, '["Chairs","Merch"]'`);
		sqlite.exec(
			`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, due_offset_minutes, tasks)
			 VALUES ('i2','dl-1','role-2', -10080, '["Confirm lineup","Poster out","Ticket link"]')`
		);

		const result = await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');
		expect(result.taskCount).toBe(5);

		const rows = sqlite
			.prepare(
				`SELECT wt.label, wt.sort_order, vs.due_at IS NULL AS scheduled
				 FROM work_task wt JOIN work_order vs ON vs.id = wt.work_order_id
				 ORDER BY scheduled DESC, wt.sort_order`
			)
			.all() as { label: string; sort_order: number; scheduled: number }[];

		expect(rows.map((r) => r.label)).toEqual([
			'Chairs',
			'Merch',
			'Confirm lineup',
			'Poster out',
			'Ticket link'
		]);
		expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 0, 1, 2]);
	});

	it('writes every task when there are more than one statement can bind', async () => {
		// 60 tasks is 240 bound parameters at four columns a row — comfortably past
		// D1's 100-per-statement cap, which is what the chunking is for.
		const labels = Array.from({ length: 60 }, (_, i) => `Task ${i}`);
		addItem(
			'i1',
			'offset_minutes, duration_minutes, tasks',
			`-180, 120, '${JSON.stringify(labels)}'`
		);

		const result = await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');

		expect(result.taskCount).toBe(60);
		const [{ n }] = sqlite.prepare(`SELECT count(*) AS n FROM work_task`).all() as { n: number }[];
		expect(n).toBe(60);
	});

	it('refuses a list with nothing on it', async () => {
		await expect(applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1')).rejects.toThrow(
			/no items/i
		);
	});
});

/**
 * The same machinery, stamped onto a rehearsal booking instead of a show.
 *
 * A booking is a window with a start and an end, which is everything an offset
 * needs — so these assert the arithmetic is unchanged and only the anchor column
 * moved, rather than re-testing chunking and task ordering a second time.
 */
describe('applyDutyList — reservation subject', () => {
	function resItem(id: string, cols: string, vals: string) {
		sqlite.exec(
			`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, ${cols})
			 VALUES ('${id}','dl-res','role-1', ${vals})`
		);
	}

	it('measures offsets from the booking, and carries reservation_id instead of event_id', async () => {
		resItem('i1', 'offset_minutes, duration_minutes', '-15, 45');

		const result = await applyDutyList('dl-res', { kind: 'reservation', id: 'res-1' }, null);
		expect(result.workOrderIds).toHaveLength(1);

		const [row] = sqlite
			.prepare(
				`SELECT starts_at, ends_at, event_id, reservation_id, created_by_user_id
				 FROM work_order`
			)
			.all() as {
			starts_at: number;
			ends_at: number;
			event_id: string | null;
			reservation_id: string | null;
			created_by_user_id: string | null;
		}[];

		expect(row.starts_at).toBe(STARTS - 15 * 60);
		expect(row.ends_at).toBe(STARTS + 30 * 60);
		expect(row.reservation_id).toBe('res-1');
		// Exactly one anchor. A show's roster must not appear on a booking.
		expect(row.event_id).toBeNull();
		// A listener applied it, so there is no acting user to record.
		expect(row.created_by_user_id).toBeNull();
	});

	it('produces a deadline work order from a booking too', async () => {
		resItem('i1', 'due_offset_minutes', '-1440');

		await applyDutyList('dl-res', { kind: 'reservation', id: 'res-1' }, null);

		const [row] = sqlite.prepare(`SELECT starts_at, ends_at, due_at FROM work_order`).all() as {
			starts_at: number | null;
			ends_at: number | null;
			due_at: number;
		}[];
		expect(row.starts_at).toBeNull();
		expect(row.ends_at).toBeNull();
		expect(row.due_at).toBe(STARTS - 1440 * 60);
	});

	it('refuses a second apply per booking, which is what makes the listener idempotent', async () => {
		resItem('i1', 'offset_minutes, duration_minutes', '-15, 45');

		await applyDutyList('dl-res', { kind: 'reservation', id: 'res-1' }, null);
		await expect(
			applyDutyList('dl-res', { kind: 'reservation', id: 'res-1' }, null)
		).rejects.toThrow(DutyListAlreadyAppliedError);
		expect(shifts()).toHaveLength(1);
	});

	it('counts applies per booking, not across every booking at once', async () => {
		sqlite.exec(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 VALUES ('res-2','user','u1','u1','scheduled', ${STARTS + 86400}, ${ENDS + 86400})`
		);
		resItem('i1', 'offset_minutes, duration_minutes', '-15, 45');

		await applyDutyList('dl-res', { kind: 'reservation', id: 'res-1' }, null);
		await expect(
			applyDutyList('dl-res', { kind: 'reservation', id: 'res-2' }, null)
		).resolves.toBeTruthy();
		expect(shifts()).toHaveLength(2);
	});

	it('refuses an event list on a booking, and a booking list on an event', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '-180, 120');
		resItem('i2', 'offset_minutes, duration_minutes', '-15, 45');

		await expect(applyDutyList('dl-1', { kind: 'reservation', id: 'res-1' }, null)).rejects.toThrow(
			DutyListValidationError
		);
		await expect(applyDutyList('dl-res', { kind: 'event', id: 'evt-1' }, 'u1')).rejects.toThrow(
			DutyListValidationError
		);
		expect(shifts()).toHaveLength(0);
	});

	it('refuses a doors-anchored list on a booking rather than silently using its start', async () => {
		// The row can only get here by going round the service — `createDutyList`
		// and `updateDutyList` refuse the pair. Assert apply refuses it too, since
		// that is the half a hand-written seed or a migration could reach.
		sqlite.exec(`UPDATE duty_list SET anchor = 'doors' WHERE id = 'dl-res'`);
		resItem('i1', 'offset_minutes, duration_minutes', '-15, 45');

		await expect(
			applyDutyList('dl-res', { kind: 'reservation', id: 'res-1' }, null)
		).rejects.toThrow(/no doors/i);
	});

	it('refuses a booking that no longer exists', async () => {
		resItem('i1', 'offset_minutes, duration_minutes', '-15, 45');

		await expect(
			applyDutyList('dl-res', { kind: 'reservation', id: 'gone' }, null)
		).rejects.toThrow(/no longer exists/i);
	});
});
