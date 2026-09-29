import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A new show is stamped with its deliverables (#1707): `production.created`
 * applies the one list whose trigger it is, and a re-delivered event changes
 * nothing. Against a real SQLite replayed from the migrations, which already
 * carry the `Show deliverables` list.
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
	})
}));
const capture = vi.fn();
vi.mock('$lib/server/sentry', () => ({ captureException: capture }));

const { domainEvents } = await import('$lib/server/event-bus/event-bus');
const { registerDeliverablesListeners, applyShowDeliverables } =
	await import('./deliverables-listener');
registerDeliverablesListeners();

const T0 = 1_790_000_000;
const exec = (sql: string) => sqlite.exec(sql);

beforeEach(() => {
	capture.mockClear();
	exec(`delete from work_task`);
	exec(`delete from work_order`);
	exec(`delete from event_listing`);
	exec(`update duty_list set is_active = 1`);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind)
		values ('evt', 'Friday', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show')`);
});

const stamped = () =>
	sqlite
		.prepare(
			`select title, due_at - ${T0} as due, done_when as doneWhen from work_order
			 where event_id = 'evt' and cancelled_at is null order by due_at, title`
		)
		.all() as { title: string; due: number; doneWhen: string }[];

describe('production.created', () => {
	it('stamps the nine deliverables, due relative to the show’s start', async () => {
		await domainEvents.emit('production.created', {
			productionId: 'p',
			eventId: 'evt',
			createdByUserId: null
		});
		const rows = stamped();
		expect(rows).toHaveLength(9);
		expect(rows[0]).toEqual({
			title: 'Lineup confirmed, deal agreed',
			due: -28 * 86_400,
			doneWhen: 'production_confirmed'
		});
		expect(rows.at(-1)).toEqual({
			title: 'Settlement recorded',
			due: 3 * 86_400,
			doneWhen: 'production_settled'
		});
		const tasks = sqlite.prepare(`select count(*) as n from work_task`).get() as { n: number };
		expect(tasks.n).toBe(8);
	});

	it('changes nothing when the event is delivered twice', async () => {
		const payload = { productionId: 'p', eventId: 'evt', createdByUserId: null };
		await domainEvents.emit('production.created', payload);
		await domainEvents.emit('production.created', payload);
		expect(stamped()).toHaveLength(9);
		expect(capture).not.toHaveBeenCalled();
	});

	it('does nothing while the list is archived', async () => {
		exec(`update duty_list set is_active = 0`);
		expect(await applyShowDeliverables('evt', null)).toEqual([]);
		expect(stamped()).toEqual([]);
	});

	it('reports rather than throws when the show cannot take the list', async () => {
		await domainEvents.emit('production.created', {
			productionId: 'p',
			eventId: 'missing',
			createdByUserId: null
		});
		expect(capture).toHaveBeenCalledTimes(1);
	});
});
