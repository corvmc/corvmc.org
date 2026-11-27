/**
 * The #3274 backfill and the rebuild after it, on real SQLite over the real
 * migrations: every production's producer becomes the assignee of an "Event
 * lead" task before `production.producer_user_id` and the six `door_cash_*`
 * columns go. Each case stands on its own database, so an earlier run cannot
 * excuse a later one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const NAME = 'event_lead_backfill_producer_dropped';
const statements = readFileSync(globSync(`migrations/*_${NAME}/migration.sql`)[0], 'utf8')
	.split('--> statement-breakpoint')
	.map((s) => s.trim())
	.filter(Boolean);
const rebuildAt = statements.findIndex((s) => s.includes('PRAGMA defer_foreign_keys=ON'));
const backfill = statements.slice(0, rebuildAt);
const rebuild = statements.slice(rebuildAt);

const T0 = 1_750_000_000;

function setup() {
	const { sqlite } = migratedSqlite({ through: 'sweet_slayback' });
	sqlite.exec(`insert into user (id, name, email) values
		('ana', 'Ana', 'ana@example.com'), ('ben', 'Ben', 'ben@example.com'),
		('gone', 'Gone', 'gone@example.com')`);
	sqlite.exec(`update user set deleted_at = ${T0} where id = 'gone'`);
	const show = (id: string, producer: string | null) => {
		sqlite
			.prepare("insert into project (id, name, kind) values (?, 'Show', 'production')")
			.run(`pr-${id}`);
		sqlite
			.prepare(
				`insert into event_listing (id, title, starts_at, ends_at, kind, source, status, project_id, created_by_user_id)
				 values (?, 'Show', ?, ?, 'show', 'cmc', 'published', ?, 'ana')`
			)
			.run(`ev-${id}`, T0, T0 + 3600, `pr-${id}`);
		sqlite
			.prepare(
				`insert into production (id, project_id, status, producer_user_id, created_at, updated_at)
				 values (?, ?, 'confirmed', ?, ?, ?)`
			)
			.run(`pn-${id}`, `pr-${id}`, producer, T0, T0);
	};
	const run = (sql: string[]) => {
		for (const statement of sql) sqlite.exec(statement);
	};
	const roleId = () =>
		(
			sqlite.prepare("select id from volunteer_role where name = 'Event lead'").get() as
				{ id: string } | undefined
		)?.id;
	const leadOf = (id: string) =>
		sqlite
			.prepare(
				`select t.cancelled_at as cancelled, a.user_id as who from work_order t
				 left join work_order_assignee a on a.work_order_id = t.id
				 where t.event_id = ? order by t.cancelled_at is null, t.id`
			)
			.all(`ev-${id}`);
	return { sqlite, show, run, roleId, leadOf };
}

describe('event lead backfill', () => {
	it("makes each producer the assignee of its show's lead task, and creates the role", () => {
		const { sqlite, show, run, roleId, leadOf } = setup();
		show('a', 'ana');
		show('b', null);
		show('c', 'gone');
		run(backfill);
		expect(leadOf('a')).toEqual([{ cancelled: null, who: 'ana' }]);
		expect(leadOf('b')).toEqual([]);
		expect(leadOf('c')).toEqual([]);
		const caps = sqlite
			.prepare(
				'select capability from volunteer_role_capability where volunteer_role_id = ? order by 1'
			)
			.all(roleId());
		expect(caps).toEqual([{ capability: 'event.manageGuests' }, { capability: 'production.run' }]);
		expect(
			sqlite.prepare('select count(*) as n from audit_log where subject_id = ?').get(roleId())
		).toEqual({ n: 1 });
	});

	it('creates nothing when no producer is left to name', () => {
		const { sqlite, show, run, roleId } = setup();
		show('b', null);
		show('c', 'gone');
		run(backfill);
		expect(roleId()).toBeUndefined();
		expect(sqlite.prepare('select count(*) as n from work_order').get()).toEqual({ n: 0 });
		expect(sqlite.prepare('select count(*) as n from audit_log').get()).toEqual({ n: 0 });
	});

	it('is a no-op on a second run', () => {
		const { sqlite, show, run, leadOf } = setup();
		show('a', 'ana');
		run(backfill);
		run(backfill);
		expect(leadOf('a')).toEqual([{ cancelled: null, who: 'ana' }]);
		const n = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
		expect(n("select count(*) as n from volunteer_role where name = 'Event lead'")).toBe(1);
		expect(n('select count(*) as n from work_order')).toBe(1);
		expect(n('select count(*) as n from work_order_assignee')).toBe(1);
		expect(
			sqlite
				.prepare("select count(*) as n from audit_log where action = 'capability.grants_changed'")
				.get()
		).toEqual({ n: 1 });
	});

	it('leaves a lead staff already named, and does not add a second task', () => {
		const { sqlite, show, run, leadOf } = setup();
		sqlite.exec("insert into volunteer_role (id, name) values ('role-1', 'Event lead')");
		sqlite.exec(
			`insert into volunteer_role_capability (volunteer_role_id, capability) values ('role-1', 'production.run')`
		);
		show('a', 'ana');
		sqlite.exec(`insert into work_order (id, volunteer_role_id, event_id, title) values ('t1', 'role-1', 'ev-a', 'Event lead');
			insert into work_order_assignee (work_order_id, user_id) values ('t1', 'ben')`);
		run(backfill);
		expect(leadOf('a')).toEqual([{ cancelled: null, who: 'ben' }]);
		// The role keeps its row and gains the capability it was missing.
		expect(
			sqlite
				.prepare(
					"select capability from volunteer_role_capability where volunteer_role_id = 'role-1' order by 1"
				)
				.all()
		).toEqual([{ capability: 'event.manageGuests' }, { capability: 'production.run' }]);
	});

	it('names the producer on an unassigned task and opens a new one past a cancelled task', () => {
		const { sqlite, show, run, leadOf } = setup();
		sqlite.exec("insert into volunteer_role (id, name) values ('role-1', 'Event lead')");
		show('a', 'ana');
		show('b', 'ben');
		sqlite.exec(`insert into work_order (id, volunteer_role_id, event_id, title) values ('t1', 'role-1', 'ev-a', 'Event lead');
			insert into work_order (id, volunteer_role_id, event_id, title, cancelled_at) values ('t2', 'role-1', 'ev-b', 'Event lead', ${T0})`);
		run(backfill);
		expect(leadOf('a')).toEqual([{ cancelled: null, who: 'ana' }]);
		expect(leadOf('b')).toEqual([
			{ cancelled: T0, who: null },
			{ cancelled: null, who: 'ben' }
		]);
	});
});

describe('the rebuild that follows', () => {
	it('drops the producer and door cash columns and keeps children, indexes and triggers', () => {
		const { sqlite, show, run } = setup();
		show('a', 'ana');
		sqlite.exec(`insert into production_till_count (id, production_id, kind, cash_cents, counted_at)
			values ('tc', 'pn-a', 'handoff', 500, ${T0});
			insert into production_expense (id, production_id, label, category, amount_cents)
			values ('ex', 'pn-a', 'Sound', 'other', 100)`);
		run(backfill);
		run(rebuild);
		const cols = (sqlite.prepare('pragma table_info(production)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).not.toContain('producer_user_id');
		expect(cols.filter((c) => c.startsWith('door_cash_'))).toEqual([]);
		expect(cols).toContain('door_count');
		expect(sqlite.prepare('select count(*) as n from production_till_count').get()).toEqual({
			n: 1
		});
		expect(sqlite.prepare('select count(*) as n from production_expense').get()).toEqual({ n: 1 });
		const names = (type: string) =>
			(
				sqlite
					.prepare('select name from sqlite_master where type = ? and tbl_name = ?')
					.all(type, 'production') as {
					name: string;
				}[]
			).map((r) => r.name);
		expect(names('index')).not.toContain('idx_production_producer');
		expect(names('trigger').sort()).toEqual([
			'production_project_required_insert',
			'production_project_required_update'
		]);
		expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([]);
	});
});
