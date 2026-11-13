import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The listings count per category, against a real SQLite: the count is the SQL (#2788). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listCategories } = await import('./local-resource-service');

beforeEach(() => {
	sqlite.exec('delete from local_resource');
	sqlite.exec('delete from local_resource_category');
	sqlite.exec(
		`insert into local_resource_category (id, name, display_order, created_at, updated_at) values
			('venues', 'Venues', 0, 1, 1),
			('shops', 'Shops', 1, 1, 1)`
	);
	sqlite.exec(
		`insert into local_resource (id, category_id, name, status, display_order, created_at, updated_at) values
			('a', 'venues', 'Hall', 'published', 0, 1, 1),
			('b', 'venues', 'Barn', 'removed', 0, 1, 1)`
	);
});

describe('listCategories', () => {
	it('counts the listings filed under each category', async () => {
		const counts = Object.fromEntries(
			(await listCategories()).map((c) => [c.id, Number(c.listings)])
		);
		expect(counts).toEqual({ venues: 2, shops: 0 });
	});
});
