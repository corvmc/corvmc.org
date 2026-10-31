import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Template work stamped while its anchor had no time is placed once the time
 * is set (#2034): by the production's clock, and by the project's start.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			sqlite.exec('begin');
			try {
				const out = [];
				for (const s of stmts) out.push(await s);
				sqlite.exec('commit');
				return out;
			} catch (e) {
				sqlite.exec('rollback');
				throw e;
			}
		}
	})
}));

const { applyDutyList } = await import('./duty-list-service');
const { updateProductionDetails } = await import('$lib/server/production/production-service');
const { updateProject, attachToProject } = await import('$lib/server/project/project-service');

const T = Date.UTC(2026, 10, 7, 1, 0) / 1000;
const rows = () =>
	sqlite
		.prepare(
			`select starts_at s, ends_at e, due_at d, pending_offset_minutes p
			 from work_order order by coalesce(starts_at, due_at, 0), pending_offset_minutes`
		)
		.all();

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
		'project',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`
		insert into user (id, name, email) values ('u-1', 'Nia', 'nia@example.test');
		insert into volunteer_role (id, name) values ('role-1', 'Crew');
		insert into project (id, name, kind) values ('proj-1', 'Saturday show', 'production');
		insert into production (id, project_id) values ('prod-1', 'proj-1');
		insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, project_id)
			values ('ev-1', 'Saturday show', ${T + 7200}, ${T + 14400}, 'u-1', 'proj-1');
	`);
});

function template(anchor: string) {
	sqlite.exec(`
		insert into duty_list (id, name, anchor, subject) values ('tpl', 'Crew', '${anchor}', 'project');
		insert into duty_list_item (id, duty_list_id, volunteer_role_id, offset_minutes, duration_minutes)
			values ('i-1', 'tpl', 'role-1', 0, 90);
		insert into duty_list_item (id, duty_list_id, volunteer_role_id, due_offset_minutes)
			values ('i-2', 'tpl', 'role-1', 30);
	`);
}

describe('placing pending work', () => {
	it('places load-in work when load-in is set, at the exact instant', async () => {
		template('load_in');
		const { warnings } = await applyDutyList('tpl', { kind: 'project', id: 'proj-1' }, 'u-1');
		expect(warnings).toHaveLength(1);

		await updateProductionDetails('prod-1', { loadInAt: new Date(T * 1000) });

		expect(rows()).toEqual([
			{ s: T, e: T + 90 * 60, d: null, p: null },
			{ s: null, e: null, d: T + 30 * 60, p: null }
		]);
	});

	it('leaves work at another anchor pending', async () => {
		template('load_out');
		await applyDutyList('tpl', { kind: 'project', id: 'proj-1' }, 'u-1');

		await updateProductionDetails('prod-1', { loadInAt: new Date(T * 1000) });

		expect(rows()).toEqual([
			{ s: null, e: null, d: null, p: 0 },
			{ s: null, e: null, d: null, p: 30 }
		]);
	});

	it('places project-start work when the project gets a start', async () => {
		template('project_start');
		await applyDutyList('tpl', { kind: 'project', id: 'proj-1' }, 'u-1');

		await updateProject('proj-1', { startsAt: new Date(T * 1000) });

		expect(rows()).toEqual([
			{ s: T, e: T + 90 * 60, d: null, p: null },
			{ s: null, e: null, d: T + 30 * 60, p: null }
		]);
	});

	it('places event work and names the event when the project gains its first one (#2084)', async () => {
		template('start');
		sqlite.exec(`
			insert into project (id, name, kind) values ('proj-2', 'Benefit night', 'production');
			insert into event_listing (id, title, starts_at, ends_at, created_by_user_id)
				values ('ev-2', 'Benefit night', ${T}, ${T + 7200}, 'u-1');
		`);
		const { warnings } = await applyDutyList('tpl', { kind: 'project', id: 'proj-2' }, 'u-1');
		expect(warnings).toHaveLength(1);

		await attachToProject('event_listing', 'ev-2', 'proj-2');

		expect(rows()).toEqual([
			{ s: T, e: T + 90 * 60, d: null, p: null },
			{ s: null, e: null, d: T + 30 * 60, p: null }
		]);
		const events = sqlite.prepare(`select distinct event_id ev from work_order`).all();
		expect(events).toEqual([{ ev: 'ev-2' }]);
	});

	it('names the event but leaves production work pending until its time is set', async () => {
		template('load_in');
		sqlite.exec(`
			insert into project (id, name, kind) values ('proj-2', 'Benefit night', 'production');
			insert into event_listing (id, title, starts_at, ends_at, created_by_user_id)
				values ('ev-2', 'Benefit night', ${T}, ${T + 7200}, 'u-1');
		`);
		await applyDutyList('tpl', { kind: 'project', id: 'proj-2' }, 'u-1');

		await attachToProject('event_listing', 'ev-2', 'proj-2');

		expect(rows()).toEqual([
			{ s: null, e: null, d: null, p: 0 },
			{ s: null, e: null, d: null, p: 30 }
		]);
		const events = sqlite.prepare(`select distinct event_id ev from work_order`).all();
		expect(events).toEqual([{ ev: 'ev-2' }]);
	});

	it('moves placed work by the delta on the next change, not twice', async () => {
		template('load_in');
		await applyDutyList('tpl', { kind: 'project', id: 'proj-1' }, 'u-1');
		await updateProductionDetails('prod-1', { loadInAt: new Date(T * 1000) });

		await updateProductionDetails('prod-1', { loadInAt: new Date((T + 600) * 1000) });

		expect(rows()).toEqual([
			{ s: T + 600, e: T + 600 + 90 * 60, d: null, p: null },
			{ s: null, e: null, d: T + 600 + 30 * 60, p: null }
		]);
	});
});
