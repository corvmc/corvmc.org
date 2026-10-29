/**
 * `applyDutyList` against a real database on the real migrated schema.
 *
 * The arithmetic is the point: "3 hours before doors" has to land on a real
 * instant in the right column — `startsAt` when windowed, `dueAt` when a
 * deadline — and the CHECKs have to accept it. A template is stamped into a
 * project; its event anchors read the project's earliest show (#2034).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

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
	getRowCount: () => 0
}));

const {
	applyDutyList,
	createDutyList,
	getDutyListDetail,
	listDutyLists,
	DutyListAlreadyAppliedError
} = await import('./duty-list-service');

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const DOORS = at('2026-10-10T02:00:00Z');
const STARTS = at('2026-10-10T03:00:00Z');
const ENDS = at('2026-10-10T07:00:00Z');
/** The show's own clock, which is not the listing's. */
const LOAD_IN = at('2026-10-10T00:00:00Z');
const SOUNDCHECK = at('2026-10-10T01:30:00Z');
const FIRST_SET = at('2026-10-10T03:30:00Z');
const CURFEW = at('2026-10-10T06:00:00Z');
const LOAD_OUT = at('2026-10-10T08:00:00Z');
const PROJECT_START = at('2026-10-01T19:00:00Z');

const SHOW = { kind: 'project', id: 'proj-1' } as const;

beforeEach(() => {
	for (const t of [
		'audit_log',
		'work_task',
		'work_order',
		'duty_list_item',
		'duty_list',
		'project_section',
		'event_listing',
		'production',
		'reservation',
		'project'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	// The deliverables migration writes a Booking Lead of its own.
	sqlite.exec(`DELETE FROM volunteer_role WHERE id LIKE 'role-%' OR name = 'Booking Lead'`);
	sqlite.exec(`DELETE FROM user WHERE id = 'u1'`);

	sqlite.exec(`
		INSERT INTO user (id, name, email, email_verified) VALUES ('u1','Coord','c@example.com',1);
		INSERT INTO volunteer_role (id, name) VALUES ('role-1','Front Desk'), ('role-2','Booking Lead');
		INSERT INTO project (id, name, kind, starts_at) VALUES ('proj-1', 'Show', 'production', ${PROJECT_START});
		INSERT INTO event_listing (id, title, starts_at, ends_at, doors_at, created_by_user_id, project_id)
			VALUES ('evt-1','Show', ${STARTS}, ${ENDS}, ${DOORS}, 'u1', 'proj-1');
		INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			VALUES ('res-1','user','u1','u1','scheduled', ${STARTS}, ${ENDS});
		INSERT INTO duty_list (id, name, anchor, subject) VALUES ('dl-1','Standard Show','doors','project');
		INSERT INTO duty_list (id, name, anchor, subject, auto_apply_on)
			VALUES ('dl-res','Rehearsal Orientation','start','reservation','reservation.first');
	`);
});

function addItem(id: string, cols: string, vals: string, list = 'dl-1') {
	sqlite.exec(
		`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, ${cols})
		 VALUES ('${id}','${list}','role-1', ${vals})`
	);
}

const anchor = (a: string) => sqlite.exec(`UPDATE duty_list SET anchor = '${a}' WHERE id = 'dl-1'`);

function shifts() {
	return sqlite
		.prepare(
			`SELECT id, starts_at, ends_at, due_at, capacity, duty_list_id, event_id, project_id,
				pending_offset_minutes, pending_duration_minutes
			 FROM work_order ORDER BY coalesce(starts_at, due_at)`
		)
		.all() as {
		id: string;
		starts_at: number | null;
		ends_at: number | null;
		due_at: number | null;
		capacity: number;
		duty_list_id: string | null;
		event_id: string | null;
		project_id: string | null;
		pending_offset_minutes: number | null;
		pending_duration_minutes: number | null;
	}[];
}

function withProduction(cols = 'load_in_at, soundcheck_at, first_set_at, curfew_at, load_out_by') {
	const vals = {
		load_in_at: LOAD_IN,
		soundcheck_at: SOUNDCHECK,
		first_set_at: FIRST_SET,
		curfew_at: CURFEW,
		load_out_by: LOAD_OUT
	};
	const names = cols.split(',').map((c) => c.trim());
	sqlite.exec(
		`INSERT INTO production (id, status, project_id, ${names.join(', ')})
		 VALUES ('prod-1','confirmed', 'proj-1', ${names.map((n) => vals[n as keyof typeof vals]).join(', ')})`
	);
	sqlite.exec(`UPDATE event_listing SET production_id = 'prod-1' WHERE id = 'evt-1'`);
}

describe('applyDutyList — project subject', () => {
	it('turns a windowed item into a scheduled shift, measured from the show’s doors', async () => {
		addItem('i1', 'offset_minutes, duration_minutes, capacity', '-180, 120, 2');

		const result = await applyDutyList('dl-1', SHOW, 'u1');

		const [row] = shifts();
		expect(row.starts_at).toBe(DOORS - 180 * 60);
		expect(row.ends_at).toBe(DOORS - 60 * 60);
		expect(row.due_at).toBeNull();
		expect(row.capacity).toBe(2);
		expect(row.duty_list_id).toBe('dl-1');
		// In the project, and at the show it was timed from.
		expect(row.project_id).toBe('proj-1');
		expect(row.event_id).toBe('evt-1');
		expect(result.warnings).toEqual([]);
	});

	it('lands an offset of zero on the anchor instant exactly', async () => {
		anchor('start');
		addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

		await applyDutyList('dl-1', SHOW, 'u1');

		expect(shifts()[0]).toMatchObject({ starts_at: STARTS, ends_at: STARTS + 3600 });
	});

	it('turns a deadline item into an unscheduled work order with a due date', async () => {
		addItem('i1', 'due_offset_minutes', '-10080');

		await applyDutyList('dl-1', SHOW, 'u1');

		const [row] = shifts();
		expect(row.starts_at).toBeNull();
		expect(row.ends_at).toBeNull();
		expect(row.due_at).toBe(DOORS - 10080 * 60);
	});

	it('falls back to the start time when the event has no doors', async () => {
		sqlite.exec(`UPDATE event_listing SET doors_at = NULL`);
		addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

		await applyDutyList('dl-1', SHOW, 'u1');

		expect(shifts()[0].starts_at).toBe(STARTS);
	});

	it('times from the earliest event still on, and from a named one when given', async () => {
		anchor('start');
		sqlite.exec(`
			INSERT INTO event_listing (id, title, starts_at, ends_at, created_by_user_id, project_id, status)
				VALUES ('evt-0','Night zero', ${STARTS - 86400}, ${ENDS - 86400}, 'u1', 'proj-1', 'cancelled'),
				       ('evt-2','Night two', ${STARTS + 86400}, ${ENDS + 86400}, 'u1', 'proj-1', 'published');
		`);
		addItem('i1', 'offset_minutes, duration_minutes', '0, 60');

		await applyDutyList('dl-1', SHOW, 'u1');
		expect(shifts()[0]).toMatchObject({ starts_at: STARTS, event_id: 'evt-1' });

		sqlite.exec(`UPDATE work_order SET cancelled_at = unixepoch()`);
		await applyDutyList('dl-1', { ...SHOW, eventId: 'evt-2' }, 'u1');
		expect(shifts().find((r) => r.event_id === 'evt-2')?.starts_at).toBe(STARTS + 86400);
	});

	it('measures a project-start item from the project, with no event', async () => {
		anchor('project_start');
		addItem('i1', 'offset_minutes, duration_minutes', '10080, 240');

		await applyDutyList('dl-1', SHOW, 'u1');

		expect(shifts()[0]).toMatchObject({
			starts_at: PROJECT_START + 10080 * 60,
			event_id: null,
			project_id: 'proj-1'
		});
	});

	it.each([
		['load_in', LOAD_IN],
		['soundcheck', SOUNDCHECK],
		['first_set', FIRST_SET],
		['curfew', CURFEW],
		['load_out', LOAD_OUT]
	])('anchors to the production’s %s', async (a, time) => {
		withProduction();
		anchor(a);
		addItem('i1', 'offset_minutes, duration_minutes', '-30, 60');

		await applyDutyList('dl-1', SHOW, 'u1');

		expect(shifts()[0].starts_at).toBe(time - 30 * 60);
	});

	describe('a missing anchor time', () => {
		it.each([
			[
				'end',
				() => sqlite.exec(`UPDATE event_listing SET ends_at = NULL, source = 'band'`),
				/no end time/
			],
			['load_in', () => {}, /no production/],
			['soundcheck', () => withProduction('load_in_at'), /no soundcheck time/],
			['project_start', () => sqlite.exec(`UPDATE project SET starts_at = NULL`), /no start date/],
			['start', () => sqlite.exec(`DELETE FROM event_listing`), /no event/]
		])('stamps %s items unscheduled with a warning', async (a, setUp, message) => {
			setUp();
			anchor(a);
			addItem('i1', 'offset_minutes, duration_minutes', '-30, 60');
			addItem('i2', 'due_offset_minutes', '-1440');

			const result = await applyDutyList('dl-1', SHOW, 'u1');

			expect(result.workOrderIds).toHaveLength(2);
			expect(result.warnings).toEqual([expect.stringMatching(message)]);
			const rows = shifts();
			for (const r of rows) {
				expect(r).toMatchObject({ starts_at: null, ends_at: null, due_at: null });
			}
			// Kept so retime can place them once the time is set.
			expect(
				rows.map((r) => [r.pending_offset_minutes, r.pending_duration_minutes]).sort()
			).toEqual([
				[-1440, null],
				[-30, 60]
			]);
		});
	});

	it('refuses a second apply without a reason rather than doubling the roster', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '-180, 120');

		await applyDutyList('dl-1', SHOW, 'u1');
		await expect(applyDutyList('dl-1', SHOW, 'u1')).rejects.toThrow(DutyListAlreadyAppliedError);
		await expect(applyDutyList('dl-1', SHOW, 'u1', { reason: '  ' })).rejects.toThrow(
			DutyListAlreadyAppliedError
		);
		expect(shifts()).toHaveLength(1);
	});

	it('applies again with a reason, and audits it', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '-180, 120');

		await applyDutyList('dl-1', SHOW, 'u1');
		await applyDutyList('dl-1', SHOW, 'u1', { reason: 'Second stage added' });

		expect(shifts()).toHaveLength(2);
		const audits = sqlite
			.prepare(`SELECT details FROM audit_log WHERE action = 'project.duty_list_applied'`)
			.all() as { details: string }[];
		expect(audits.map((a) => JSON.parse(a.details).reappliedReason)).toEqual([
			undefined,
			'Second stage added'
		]);
	});

	it('lets a re-apply through once the first round is cancelled', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '-180, 120');

		await applyDutyList('dl-1', SHOW, 'u1');
		sqlite.exec(`UPDATE work_order SET cancelled_at = unixepoch()`);

		await expect(applyDutyList('dl-1', SHOW, 'u1')).resolves.toBeTruthy();
		expect(shifts()).toHaveLength(2);
	});

	it('writes each item’s tasks against its own work order, in order', async () => {
		addItem('i1', 'offset_minutes, duration_minutes, tasks', `-180, 120, '["Chairs","Merch"]'`);
		sqlite.exec(
			`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, due_offset_minutes, tasks)
			 VALUES ('i2','dl-1','role-2', -10080, '["Confirm lineup","Poster out","Ticket link"]')`
		);

		const result = await applyDutyList('dl-1', SHOW, 'u1');
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
		const labels = Array.from({ length: 60 }, (_, i) => `Task ${i}`);
		addItem(
			'i1',
			'offset_minutes, duration_minutes, tasks',
			`-180, 120, '${JSON.stringify(labels)}'`
		);

		const result = await applyDutyList('dl-1', SHOW, 'u1');

		expect(result.taskCount).toBe(60);
		const [{ n }] = sqlite.prepare(`SELECT count(*) AS n FROM work_task`).all() as { n: number }[];
		expect(n).toBe(60);
	});

	it('refuses a template with nothing on it', async () => {
		await expect(applyDutyList('dl-1', SHOW, 'u1')).rejects.toThrow(/no items/i);
	});

	it('refuses a project that no longer exists', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '0, 240');

		await expect(applyDutyList('dl-1', { kind: 'project', id: 'gone' }, 'u1')).rejects.toThrow(
			/no longer exists/i
		);
	});
});

describe('a retired reservation-subject list', () => {
	it('is not listed, opened or applied', async () => {
		addItem('i1', 'offset_minutes, duration_minutes', '-15, 45', 'dl-res');

		expect((await listDutyLists({ includeInactive: true })).map((l) => l.id)).toEqual(['dl-1']);
		expect(await getDutyListDetail('dl-res')).toBeNull();
		await expect(applyDutyList('dl-res', SHOW, 'u1')).rejects.toThrow(/not found/i);
		expect(shifts()).toHaveLength(0);
	});
});

describe('createDutyList', () => {
	it('saves a project template at any anchor', async () => {
		for (const a of ['doors', 'load_out', 'project_start', 'end'] as const) {
			await expect(
				createDutyList({ name: `P ${a}`, anchor: a, createdByUserId: 'u1' })
			).resolves.toMatchObject({ subject: 'project', anchor: a });
		}
	});
});
