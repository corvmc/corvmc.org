import { describe, it, expect, beforeAll, vi } from 'vitest';

/** The index's active/archived split is a `WHERE`, so it runs against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { listProjects } = await import('./project-service');

beforeAll(() => {
	sqlite.exec(
		`insert into project (id, name, status, kind) values
			('open', 'a', 'open', 'general'),
			('planned', 'b', 'planned', 'general'),
			('going', 'c', 'in_progress', 'general'),
			('done', 'd', 'done', 'general'),
			('declined', 'e', 'declined', 'general'),
			('show', 'f', 'in_progress', 'production')`
	);
});

const ids = async (opts: Parameters<typeof listProjects>[0]) =>
	(await listProjects(opts)).map((p) => p.id).sort();

describe('listProjects', () => {
	it('treats open, planned and in progress as active', async () => {
		expect(await ids({ archived: false, kind: 'general' })).toEqual(['going', 'open', 'planned']);
	});

	it('treats done and declined as archived', async () => {
		expect(await ids({ archived: true })).toEqual(['declined', 'done']);
	});

	it('lists both, productions included, with neither filter', async () => {
		expect(await ids({})).toHaveLength(6);
	});
});
