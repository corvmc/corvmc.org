/**
 * `applyDutyList` against a real database on the real migrated schema.
 *
 * The arithmetic is the point: "3 hours before doors" has to land on a real
 * instant in the right column — `startsAt` when windowed, `dueAt` when a
 * deadline — and the CHECKs have to accept it. Neither is answerable through a
 * mock. `db.batch` is D1's; the shim below awaits statements in order instead.
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
/** The show's own clock, which is not the listing's. */
const LOAD_IN = Math.floor(new Date('2026-10-10T00:00:00Z').getTime() / 1000);
const FIRST_SET = Math.floor(new Date('2026-10-10T03:30:00Z').getTime() / 1000);
const CURFEW = Math.floor(new Date('2026-10-10T06:00:00Z').getTime() / 1000);
const LOAD_OUT = Math.floor(new Date('2026-10-10T08:00:00Z').getTime() / 1000);

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
		'production_slot',
		'production',
		'event_listing',
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
		`INSERT INTO event_listing (id, title, starts_at, ends_at, doors_at, created_by_user_id)
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
		sqlite.exec(`UPDATE event_listing SET doors_at = NULL WHERE id = 'evt-1'`);
		addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

		await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');

		expect(shifts()[0].starts_at).toBe(STARTS);
	});

	it('refuses an end-anchored list on an event with no end time, by name', async () => {
		sqlite.exec(`UPDATE duty_list SET anchor = 'end' WHERE id = 'dl-1'`);
		// `event_cmc_needs_end` forbids a CMC event without an end, so the only
		// events that can reach this branch are the ones somebody else authored.
		sqlite.exec(`UPDATE event_listing SET ends_at = NULL, source = 'band' WHERE id = 'evt-1'`);
		addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

		await expect(applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1')).rejects.toThrow(
			/no end time/i
		);
	});

	// Staffing a show from `doorsAt` alone puts every shift against the one time
	// the run of show does not turn on. These four are the show's own clock.
	describe('production anchors', () => {
		function withProduction(cols = 'load_in_at, first_set_at, curfew_at, load_out_by') {
			const vals = {
				load_in_at: LOAD_IN,
				first_set_at: FIRST_SET,
				curfew_at: CURFEW,
				load_out_by: LOAD_OUT
			};
			const names = cols.split(',').map((c) => c.trim());
			sqlite.exec(
				`INSERT INTO production (id, event_id, status, ${names.join(', ')})
				 VALUES ('prod-1','evt-1','confirmed', ${names.map((n) => vals[n as keyof typeof vals]).join(', ')})`
			);
		}

		it.each([
			['load_in', LOAD_IN],
			['first_set', FIRST_SET],
			['curfew', CURFEW],
			['load_out', LOAD_OUT]
		])('anchors to the production’s %s', async (anchor, at) => {
			withProduction();
			sqlite.exec(`UPDATE duty_list SET anchor = '${anchor}' WHERE id = 'dl-1'`);
			addItem('i1', 'offset_minutes, duration_minutes', '-30, 60');

			await applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1');

			expect(shifts()[0].starts_at).toBe(at - 30 * 60);
		});

		// Two different failures, and the difference matters to whoever reads it.
		it('says the show has no production rather than falling back to the listing', async () => {
			sqlite.exec(`UPDATE duty_list SET anchor = 'load_in' WHERE id = 'dl-1'`);
			addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

			await expect(applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1')).rejects.toThrow(
				/no production yet/i
			);
		});

		it('says the time is unset when the production exists but the column is null', async () => {
			withProduction('first_set_at');
			sqlite.exec(`UPDATE duty_list SET anchor = 'load_in' WHERE id = 'dl-1'`);
			addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

			await expect(applyDutyList('dl-1', { kind: 'event', id: 'evt-1' }, 'u1')).rejects.toThrow(
				/no load-in time set/i
			);
		});

		// Same reasoning as `doors`: a rehearsal booking has no run of show, and
		// quietly resolving to its start would read as correct everywhere.
		it('refuses a production anchor on a booking', async () => {
			sqlite.exec(`UPDATE duty_list SET anchor = 'curfew', subject = 'event' WHERE id = 'dl-res'`);
			sqlite.exec(
				`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, offset_minutes, duration_minutes)
				 VALUES ('ir1','dl-res','role-1', 0, 60)`
			);

			await expect(
				applyDutyList('dl-res', { kind: 'reservation', id: 'res-1' }, 'u1')
			).rejects.toThrow(DutyListValidationError);
		});
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
