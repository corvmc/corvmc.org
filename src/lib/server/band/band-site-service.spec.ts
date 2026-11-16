import { describe, it, expect, vi } from 'vitest';

// `getOrCreateBandSiteId` against a real SQLite (#2681): two calls that both
// read no site insert once between them, through `idx_band_site_group`.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { getOrCreateBandSiteId } = await import('./band-site-service');

describe('getOrCreateBandSiteId', () => {
	it('creates one site when two first reads overlap', async () => {
		sqlite.exec(`insert into "group" (id, kind, name, slug) values ('g1', 'band', 'Band', 'band')`);

		const ids = await Promise.all([getOrCreateBandSiteId('g1'), getOrCreateBandSiteId('g1')]);

		const sites = sqlite.prepare(`select id from band_site where group_id = 'g1'`).all() as {
			id: string;
		}[];
		expect(sites).toHaveLength(1);
		expect(ids).toEqual([sites[0].id, sites[0].id]);
	});

	it('refuses a group that does not exist', async () => {
		await expect(getOrCreateBandSiteId('nope')).rejects.toThrow(/No group/);
	});
});
