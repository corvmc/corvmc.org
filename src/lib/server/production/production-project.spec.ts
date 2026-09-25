import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * Every production is a project, against a real SQLite replayed from the
 * committed migrations: the batch, the required-project triggers, and the
 * backfill that gave every existing production its project.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite({ foreignKeys: true });
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

const { createShowProject, deleteShowProject, showCommittees } =
	await import('./production-project');

const BACKFILL = globSync('migrations/*_production_project_backfill/migration.sql')[0];

function runBackfill() {
	for (const statement of readFileSync(BACKFILL, 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean)) {
		sqlite.exec(statement);
	}
}

function rows<T>(sql: string, ...params: unknown[]): T[] {
	return sqlite.prepare(sql).all(...params) as T[];
}

function committee(id: string, slug: string, deleted = false) {
	sqlite
		.prepare(
			`insert into "group" (id, name, slug, kind, deleted_at) values (?, ?, ?, 'committee', ?)`
		)
		.run(id, slug, slug, deleted ? 1 : null);
}

beforeEach(() => {
	sqlite.pragma('foreign_keys = OFF');
	for (const t of [
		'financial_entry',
		'project_committee',
		'event_listing',
		'production',
		'project',
		'"group"'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.pragma('foreign_keys = ON');
});

describe('createShowProject', () => {
	it('writes the project, the production and both show committees', async () => {
		committee('g-book', 'booking-committee');
		committee('g-prod', 'production-committee');

		await createShowProject({
			productionId: 'prod-1',
			projectId: 'proj-1',
			name: 'Friday bill',
			startsAt: new Date('2026-10-02T02:00:00Z'),
			endsAt: new Date('2026-10-02T06:00:00Z'),
			createdByUserId: null
		});

		expect(rows(`select id, kind, name from project`)).toEqual([
			{ id: 'proj-1', kind: 'production', name: 'Friday bill' }
		]);
		expect(rows(`select id, project_id from production`)).toEqual([
			{ id: 'prod-1', project_id: 'proj-1' }
		]);
		expect(rows(`select group_id, role from project_committee order by role`)).toEqual([
			{ group_id: 'g-book', role: 'booking' },
			{ group_id: 'g-prod', role: 'production' }
		]);
	});

	it('skips a show committee that is missing or deleted', async () => {
		committee('g-book', 'booking-committee', true);

		expect(await showCommittees()).toEqual([]);
		await createShowProject({
			productionId: 'prod-1',
			projectId: 'proj-1',
			name: 'Quiet night',
			startsAt: null,
			endsAt: null,
			createdByUserId: null
		});
		expect(rows(`select * from project_committee`)).toEqual([]);
	});

	it('drops an end that is not after the start rather than failing the check', async () => {
		const at = new Date('2026-10-02T02:00:00Z');
		await createShowProject({
			productionId: 'prod-1',
			projectId: 'proj-1',
			name: 'Zero-length',
			startsAt: at,
			endsAt: at,
			createdByUserId: null
		});
		expect(rows(`select ends_at from project`)).toEqual([{ ends_at: null }]);
	});

	it('undoes both rows', async () => {
		await createShowProject({
			productionId: 'prod-1',
			projectId: 'proj-1',
			name: 'Lost the race',
			startsAt: null,
			endsAt: null,
			createdByUserId: null
		});
		await deleteShowProject('prod-1');
		expect(rows(`select id from production`)).toEqual([]);
		expect(rows(`select id from project`)).toEqual([]);
	});
});

describe('production_project_required', () => {
	it('refuses a production with no project', () => {
		expect(() => sqlite.exec(`insert into production (id) values ('p')`)).toThrow(
			'production.project_id is required'
		);
	});

	it('refuses clearing one', async () => {
		await createShowProject({
			productionId: 'prod-1',
			projectId: 'proj-1',
			name: 'x',
			startsAt: null,
			endsAt: null,
			createdByUserId: null
		});
		expect(() => sqlite.exec(`update production set project_id = null`)).toThrow(
			'production.project_id is required'
		);
	});
});

describe('the backfill', () => {
	/** Rows as they stood before the migration: productions with no project. */
	function legacy() {
		sqlite.pragma('foreign_keys = OFF');
		sqlite.exec(`drop trigger production_project_required_insert`);
		committee('g-book', 'booking-committee');
		committee('g-prod', 'production-committee');
		committee('g-fac', 'facility-committee');
		sqlite.exec(`
			insert into production (id, status) values ('prod-a', 'completed'), ('prod-b', 'draft');
			insert into project (id, name, group_id) values ('proj-owned', 'Renovation', 'g-fac');
			insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, production_id, project_id)
				values ('evt-a', 'Show A', 1790000000, 1790010000, 'u', 'cmc', 'show', 'prod-a', null),
				       ('evt-b', 'Show B', 1790100000, 1790110000, 'u', 'cmc', 'show', 'prod-b', 'proj-owned');
			insert into financial_entry (id, amount_cents, kind, category, occurred_at, settlement, settlement_group, subject_type, subject_id, description)
				values ('fe-pool', 7000, 'pass_through', 'act_payout', 1790000000, 'stripe', 'evt-a', 'ticket', 'pur-1', 'pool'),
				       ('fe-cut', 3000, 'earned', 'ticket_sales', 1790000000, 'stripe', null, 'ticket', 'pur-1', 'cut'),
				       ('fe-pay', -7000, 'pass_through', 'act_payout', 1790020000, 'cash', 'evt-a', 'production', 'prod-a', 'paid'),
				       ('fe-other', 500, 'earned', 'ticket_sales', 1790000000, 'stripe', null, 'ticket', 'pur-9', 'unrelated');
		`);
		runBackfill();
		sqlite.pragma('foreign_keys = ON');
	}

	it('gives every production a project, adopting a listing project nobody else claims', () => {
		legacy();

		const byProduction = rows<{ id: string; project_id: string; kind: string; name: string }>(
			`select p.id, p.project_id, pr.kind, pr.name
			 from production p join project pr on pr.id = p.project_id order by p.id`
		);
		expect(byProduction).toHaveLength(2);
		expect(byProduction[0]).toMatchObject({ id: 'prod-a', kind: 'production', name: 'Show A' });
		expect(byProduction[1]).toMatchObject({ project_id: 'proj-owned', kind: 'production' });

		// The listing points at its show's project.
		expect(rows(`select id, project_id from event_listing order by id`)).toEqual([
			{ id: 'evt-a', project_id: byProduction[0].project_id },
			{ id: 'evt-b', project_id: 'proj-owned' }
		]);
		// A finished show's new project is done.
		expect(rows(`select status from project where id = ?`, byProduction[0].project_id)).toEqual([
			{ status: 'done' }
		]);
	});

	it('writes owner rows from group_id and both show committees', () => {
		legacy();
		expect(
			rows(
				`select group_id, role from project_committee where project_id = 'proj-owned' order by role`
			)
		).toEqual([
			{ group_id: 'g-book', role: 'booking' },
			{ group_id: 'g-fac', role: 'owner' },
			{ group_id: 'g-prod', role: 'production' }
		]);
	});

	it("files a show's ledger rows under its project, sibling legs included", () => {
		legacy();
		const [{ project_id: projA }] = rows<{ project_id: string }>(
			`select project_id from production where id = 'prod-a'`
		);
		expect(rows(`select id, project_id from financial_entry order by id`)).toEqual([
			{ id: 'fe-cut', project_id: projA },
			{ id: 'fe-other', project_id: null },
			{ id: 'fe-pay', project_id: projA },
			{ id: 'fe-pool', project_id: projA }
		]);
	});

	it('changes nothing on a second run', () => {
		legacy();
		const snapshot = () => ({
			projects: rows(`select * from project order by id`),
			productions: rows(`select id, project_id from production order by id`),
			committees: rows(`select project_id, group_id, role from project_committee order by 1, 2`),
			ledger: rows(`select id, project_id from financial_entry order by id`)
		});
		const before = snapshot();
		runBackfill();
		expect(snapshot()).toEqual(before);
	});
});
