import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * A listing's production is the one on its project (#2076), against a real
 * SQLite: the backfill that kept every link, the one-listing rule the services
 * hold in place of `uq_event_production`, and the refusal to strand a show.
 */
const { sqlite, testDb, legacySqlite } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return {
		...migratedSqlite({ foreignKeys: true }),
		// The schema as it stood before the column went: `production_id` still there.
		legacySqlite: migratedSqlite({ foreignKeys: true, through: 'backfill_templates_to_project' })
			.sqlite
	};
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	// better-sqlite3 reports `changes` where D1 reports `meta.changes`.
	getRowCount: (r: { changes?: number }) => r?.changes ?? 0
}));

const { attachToProject, detachFromProject } = await import('$lib/server/project/project-service');
const { createProduction, ProductionExistsError } = await import('./production-service');
const { ProductionListingTakenError, ListingAnnouncesShowError, projectOfEvent } =
	await import('./production-scope');

function migration(name: string): string[] {
	const [file] = globSync(`migrations/*_${name}/migration.sql`);
	return readFileSync(file, 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
}

const listing = (id: string, projectId: string | null) =>
	sqlite
		.prepare(
			`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, project_id)
			 values (?, ?, 1790000000, 1790010000, 'u', 'cmc', 'show', ?)`
		)
		.run(id, `Show ${id}`, projectId);
const projectOf = (id: string) =>
	(
		sqlite.prepare(`select project_id from event_listing where id = ?`).get(id) as {
			project_id: string | null;
		}
	).project_id;

beforeEach(() => {
	sqlite.pragma('foreign_keys = OFF');
	for (const t of [
		'work_order',
		'project_committee',
		'event_listing',
		'production',
		'project',
		'user'
	])
		sqlite.exec(`delete from ${t}`);
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(`
		insert into user (id, name, email) values ('u', 'Staff', 'u@x.test');
		insert into project (id, name, kind) values ('show', 'Friday', 'production'), ('fest', 'Fest', 'general');
		insert into production (id, project_id) values ('prod', 'show');
	`);
	listing('evt-show', 'show');
});

describe('the backfill', () => {
	it('puts every listing that names a production on that production’s project, then drops the column', () => {
		const db = legacySqlite;
		db.exec(`
			insert into user (id, name, email) values ('u', 'Staff', 'u@x.test');
			insert into project (id, name, kind) values ('pa', 'A', 'production'), ('pb', 'B', 'production'), ('g', 'G', 'general');
			insert into production (id, project_id) values ('prod-a', 'pa'), ('prod-b', 'pb');
			insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, production_id, project_id) values
				('missing', 'A', 1, 2, 'u', 'cmc', 'show', 'prod-a', null),
				('drifted', 'B', 1, 2, 'u', 'cmc', 'show', 'prod-b', 'g'),
				('gig', 'C', 1, 2, 'u', 'cmc', 'show', null, 'g'),
				('bare', 'D', 1, 2, 'u', 'cmc', 'show', null, null);
		`);
		// The backfill, then the generated drop that follows it.
		for (const name of ['event_production_via_project', 'bizarre_spirit'])
			for (const statement of migration(name)) db.exec(statement);

		expect(db.prepare(`select id, project_id from event_listing order by id`).all()).toEqual([
			{ id: 'bare', project_id: null },
			{ id: 'drifted', project_id: 'pb' },
			{ id: 'gig', project_id: 'g' },
			{ id: 'missing', project_id: 'pa' }
		]);
		const cols = db.prepare(`select name from pragma_table_info('event_listing')`).all();
		expect(cols).not.toContainEqual({ name: 'production_id' });
	});
});

describe('one listing per production project', () => {
	it('refuses to attach a second listing to a show’s project', async () => {
		listing('evt-2', null);
		await expect(attachToProject('event_listing', 'evt-2', 'show')).rejects.toBeInstanceOf(
			ProductionListingTakenError
		);
		expect(projectOf('evt-2')).toBeNull();
	});

	it('lets a general project take any number of listings', async () => {
		listing('night-1', 'fest');
		listing('night-2', null);
		await attachToProject('event_listing', 'night-2', 'fest');
		expect(projectOf('night-2')).toBe('fest');
	});

	it('finds the show through the project', async () => {
		expect(await projectOfEvent('evt-show')).toEqual({ projectId: 'show', productionId: 'prod' });
		listing('gig', 'fest');
		expect(await projectOfEvent('gig')).toEqual({ projectId: 'fest', productionId: null });
	});

	it('does not open a second production on a listing that already announces one', async () => {
		await expect(createProduction('evt-show')).rejects.toBeInstanceOf(ProductionExistsError);
		expect(projectOf('evt-show')).toBe('show');
		expect(sqlite.prepare(`select count(*) n from production`).get()).toEqual({ n: 1 });
	});

	it('moves a festival night onto its new show’s project', async () => {
		listing('night', 'fest');
		const row = await createProduction('night');
		expect(projectOf('night')).toBe(row.projectId);
	});
});

describe('a listing that announces a show stays on the show’s project', () => {
	it('refuses to move it to another project', async () => {
		await expect(attachToProject('event_listing', 'evt-show', 'fest')).rejects.toBeInstanceOf(
			ListingAnnouncesShowError
		);
		expect(projectOf('evt-show')).toBe('show');
	});

	it('refuses to detach it', async () => {
		await expect(detachFromProject('event_listing', 'evt-show')).rejects.toBeInstanceOf(
			ListingAnnouncesShowError
		);
		expect(projectOf('evt-show')).toBe('show');
	});

	it('still detaches a listing from a general project', async () => {
		listing('gig', 'fest');
		await detachFromProject('event_listing', 'gig');
		expect(projectOf('gig')).toBeNull();
	});
});
