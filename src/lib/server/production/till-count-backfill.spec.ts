/**
 * The #3273 backfill, on real SQLite over the real migrations, stopped after
 * the table it fills: the first door count becomes a handoff and the recount
 * becomes the staff count, so a past show keeps its agreed or mismatch answer.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const sqlOf = (name: string) =>
	readFileSync(globSync(`migrations/*_${name}/migration.sql`)[0], 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);

const { sqlite } = migratedSqlite({ through: 'far_ares' });

const T0 = 1_750_000_000;
const insertProduction = (
	id: string,
	door: {
		first?: [number, string | null, number | null];
		recount?: [number, string | null, number | null];
	} = {}
) => {
	sqlite.prepare("insert into project (id, name, kind) values (?, 'Show', 'production')").run(id);
	sqlite
		.prepare(
			`insert into production (id, project_id, status, created_at, updated_at,
				door_cash_cents, door_cash_counted_by_user_id, door_cash_counted_at,
				door_cash_recount_cents, door_cash_recounted_by_user_id, door_cash_recounted_at)
			 values (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			id,
			T0,
			T0 + 99,
			door.first?.[0] ?? null,
			door.first?.[1] ?? null,
			door.first?.[2] ?? null,
			door.recount?.[0] ?? null,
			door.recount?.[1] ?? null,
			door.recount?.[2] ?? null
		);
};

const counts = (id: string) =>
	sqlite
		.prepare(
			`select kind, cash_cents as cash, counted_by_user_id as by, counted_at as at
			 from production_till_count where production_id = ? order by kind`
		)
		.all(id);

beforeAll(() => {
	sqlite.exec(`insert into user (id, name, email) values ('ana', 'Ana', 'ana@example.com'),
		('ben', 'Ben', 'ben@example.com')`);
	insertProduction('never');
	insertProduction('once', { first: [500_00, 'ana', T0 + 10] });
	insertProduction('twice', {
		first: [500_00, 'ana', T0 + 10],
		recount: [480_00, 'ben', T0 + 20]
	});
	insertProduction('unstamped', { first: [0, null, null] });
	for (const statement of sqlOf('production_till_count_backfill')) sqlite.exec(statement);
});

describe('till count backfill', () => {
	it('makes a show nobody counted into no rows', () => {
		expect(counts('never')).toEqual([]);
	});

	it('turns the first count into a handoff with its counter and time', () => {
		expect(counts('once')).toEqual([{ kind: 'handoff', cash: 500_00, by: 'ana', at: T0 + 10 }]);
	});

	it('turns the recount into the staff count beside it', () => {
		expect(counts('twice')).toEqual([
			{ kind: 'handoff', cash: 500_00, by: 'ana', at: T0 + 10 },
			{ kind: 'staff', cash: 480_00, by: 'ben', at: T0 + 20 }
		]);
	});

	it('keeps a counted zero, and stamps a count with no time at the production update', () => {
		expect(counts('unstamped')).toEqual([{ kind: 'handoff', cash: 0, by: null, at: T0 + 99 }]);
	});
});
