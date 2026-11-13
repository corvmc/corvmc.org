import { describe, it, expect, beforeEach, vi } from 'vitest';

// `joinGroup` against a real SQLite (#2695): two overlapping joins both pass
// the roster check, and the second must still read as already on the roster.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { joinGroup, AlreadyOnRosterError } = await import('./group-service');

const members = () =>
	sqlite.prepare(`select user_id from group_member where group_id = 'g-open'`).all();

beforeEach(() => {
	for (const t of ['group_member', 'group', 'user']) sqlite.exec(`delete from "${t}"`);
	sqlite.exec(`insert into user (id, name, email) values ('u-1', 'Ada', 'ada@example.com')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug, join_policy)
		values ('g-open', 'program', 'Jazz', 'jazz', 'open')`);
});

describe('joinGroup', () => {
	it('adds one row when two joins overlap, refusing the second as already on the roster', async () => {
		const results = await Promise.allSettled([
			joinGroup('g-open', 'u-1'),
			joinGroup('g-open', 'u-1')
		]);

		expect(members()).toHaveLength(1);
		expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
		const refused = results.find((r) => r.status === 'rejected');
		expect(refused?.reason).toBeInstanceOf(AlreadyOnRosterError);
	});
});
