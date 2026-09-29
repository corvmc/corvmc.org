import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Each `done_when` against a real SQLite replayed from the migrations (#1706):
 * the fact holds, the fact goes away, and the tasks still have to be ticked.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('$lib/server/production/run-of-show-service', () => ({ recomputeSetTimes: vi.fn() }));
vi.mock('$lib/server/finance/production-expense-entries', () => ({
	postProductionExpenses: vi.fn()
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { evaluateDone } = await import('./done-conditions');
import type { DoneInput } from './done-conditions';
import type { WorkDoneCondition } from '$lib/config';

const T0 = 1_790_000_000;
const exec = (sql: string) => sqlite.exec(sql);
const NOW = new Date((T0 - 86_400 * 30) * 1000);

beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'work_task',
		'work_order',
		'duty_list',
		'artifact_request',
		'event_band',
		'media_attachment',
		'media',
		'event_listing',
		'production',
		'project',
		'directory_entry',
		'volunteer_role'
	])
		exec(`delete from ${t}`);
	exec(
		`insert into volunteer_role (id, name) values ('crew', 'Door'), ('lead', 'Production Lead')`
	);
	exec(`insert into project (id, name, kind) values ('proj', 'Friday', 'production')`);
	exec(`insert into production (id, project_id, status) values ('prod', 'proj', 'draft')`);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, production_id, project_id, status)
		values ('evt', 'Friday', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show', 'prod', 'proj', 'draft')`);
});

let n = 0;
function item(doneWhen: WorkDoneCondition | null, over: Partial<DoneInput> = {}): DoneInput {
	const id = `wo-${++n}`;
	exec(`insert into work_order (id, volunteer_role_id, event_id, group_id, done_when, due_at)
		values ('${id}', 'lead', 'evt', null, ${doneWhen ? `'${doneWhen}'` : 'null'}, ${T0})`);
	return {
		id,
		eventId: 'evt',
		doneWhen,
		resolvedAt: null,
		cancelledAt: null,
		dueAt: new Date(T0 * 1000),
		...over
	};
}

const stateOf = async (row: DoneInput, now = NOW) => (await evaluateDone([row], now)).get(row.id);

function task(workOrderId: string, done: boolean) {
	exec(`insert into work_task (id, work_order_id, label, sort_order, done, done_at)
		values ('${crypto.randomUUID()}', '${workOrderId}', 'x', 0, ${done ? 1 : 0}, ${done ? T0 : 'null'})`);
}

describe('the derived state', () => {
	it('is cancelled, then resolved by hand, then overdue, then open', async () => {
		const row = item(null);
		expect(await stateOf({ ...row, cancelledAt: new Date() })).toBe('cancelled');
		expect(await stateOf({ ...row, resolvedAt: new Date() })).toBe('done');
		expect(await stateOf(row, new Date((T0 + 60) * 1000))).toBe('overdue');
		expect(await stateOf(row)).toBe('open');
	});

	it('needs every task ticked as well as the fact', async () => {
		const row = item('tasks_ticked');
		expect(await stateOf(row)).toBe('done');
		task(row.id, false);
		expect(await stateOf(row)).toBe('open');
		exec(`update work_task set done = 1, done_at = ${T0} where work_order_id = '${row.id}'`);
		expect(await stateOf(row)).toBe('done');
	});

	it('never holds a show-fact for an item with no show', async () => {
		const row = item('description_set', { eventId: null });
		exec(`update event_listing set description = 'x'`);
		expect(await stateOf(row)).toBe('open');
	});
});

describe('each condition', () => {
	it('production_confirmed: confirmed or later', async () => {
		const row = item('production_confirmed');
		expect(await stateOf(row)).toBe('open');
		for (const s of ['confirmed', 'completed', 'settled', 'closed']) {
			exec(`update production set status = '${s}'`);
			expect(await stateOf(row)).toBe('done');
		}
		exec(`update production set status = 'cancelled'`);
		expect(await stateOf(row)).toBe('open');
	});

	it('production_settled: settled or closed', async () => {
		const row = item('production_settled');
		exec(`update production set status = 'completed'`);
		expect(await stateOf(row)).toBe('open');
		exec(`update production set status = 'settled'`);
		expect(await stateOf(row)).toBe('done');
	});

	it('description_set: non-empty after trimming', async () => {
		const row = item('description_set');
		exec(`update event_listing set description = '   '`);
		expect(await stateOf(row)).toBe('open');
		exec(`update event_listing set description = 'Three bands'`);
		expect(await stateOf(row)).toBe('done');
	});

	it('poster_set: a poster attachment, and open again when it goes', async () => {
		const row = item('poster_set');
		expect(await stateOf(row)).toBe('open');
		exec(
			`insert into media (id, key, content_type, byte_size) values ('m', 'posters/a.png', 'image/png', 1)`
		);
		exec(`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			values ('ma', 'm', 'event_listing', 'evt', 'poster')`);
		expect(await stateOf(row)).toBe('done');
		exec(`delete from media_attachment`);
		expect(await stateOf(row)).toBe('open');
	});

	it('event_published: the listing is published', async () => {
		const row = item('event_published');
		expect(await stateOf(row)).toBe('open');
		exec(`update event_listing set status = 'published'`);
		expect(await stateOf(row)).toBe('done');
	});

	it('artifacts_requested: every listed act has a live ask, and an empty bill has not been asked', async () => {
		const row = item('artifacts_requested');
		expect(await stateOf(row)).toBe('open');
		exec(`insert into directory_entry (id, name) values ('a1', 'Act One'), ('a2', 'Act Two')`);
		exec(`insert into event_band (id, event_id, name, directory_entry_id, billing_order) values
			('eb1', 'evt', 'Act One', 'a1', 0), ('eb2', 'evt', 'Act Two', 'a2', 1), ('eb3', 'evt', 'Unlisted', null, 2)`);
		exec(
			`insert into artifact_request (id, event_id, entry_id, artifact) values ('r1', 'evt', 'a1', 'tech_rider')`
		);
		expect(await stateOf(row)).toBe('open');
		exec(
			`insert into artifact_request (id, event_id, entry_id, artifact, cancelled_at) values ('r2', 'evt', 'a2', 'epk', ${T0})`
		);
		expect(await stateOf(row)).toBe('open');
		exec(
			`insert into artifact_request (id, event_id, entry_id, artifact) values ('r3', 'evt', 'a2', 'tech_rider')`
		);
		expect(await stateOf(row)).toBe('done');
	});

	it('shifts_filled: every scheduled crew shift is at capacity, committee items aside', async () => {
		const row = item('shifts_filled');
		expect(await stateOf(row)).toBe('done');
		exec(`insert into work_order (id, volunteer_role_id, event_id, starts_at, ends_at, capacity)
			values ('door', 'crew', 'evt', ${T0}, ${T0 + 3600}, 2)`);
		exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values ('s1', 'door', 'u1', 'claimed')`
		);
		expect(await stateOf(row)).toBe('open');
		exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values ('s2', 'door', 'u2', 'cancelled')`
		);
		expect(await stateOf(row)).toBe('open');
		exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values ('s3', 'door', 'u3', 'confirmed')`
		);
		expect(await stateOf(row)).toBe('done');
		exec(`insert into work_order (id, volunteer_role_id, event_id, starts_at, ends_at, cancelled_at)
			values ('gone', 'crew', 'evt', ${T0}, ${T0 + 3600}, ${T0})`);
		expect(await stateOf(row)).toBe('done');
	});

	it('close_out_done: no load-out task left open', async () => {
		const row = item('close_out_done');
		expect(await stateOf(row)).toBe('done');
		exec(`insert into duty_list (id, name, anchor) values ('lo', 'Load-out', 'load_out')`);
		exec(`insert into work_order (id, volunteer_role_id, event_id, starts_at, ends_at, duty_list_id)
			values ('lo-wo', 'crew', 'evt', ${T0}, ${T0 + 3600}, 'lo')`);
		task('lo-wo', false);
		expect(await stateOf(row)).toBe('open');
		exec(`update work_task set done = 1, done_at = ${T0} where work_order_id = 'lo-wo'`);
		expect(await stateOf(row)).toBe('done');
	});
});

describe('a batch', () => {
	it('answers every item across shows at once', async () => {
		exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, status, description)
			values ('evt2', 'Saturday', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show', 'published', 'x')`);
		const a = item('event_published');
		const b = item('event_published', { eventId: 'evt2' });
		exec(`update work_order set event_id = 'evt2' where id = '${b.id}'`);
		const c = item('description_set', { eventId: 'evt2' });
		const states = await evaluateDone([a, b, c], NOW);
		expect([states.get(a.id), states.get(b.id), states.get(c.id)]).toEqual([
			'open',
			'done',
			'done'
		]);
	});
});
