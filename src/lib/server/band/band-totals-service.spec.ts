import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { getBandTotals } = await import('./band-totals-service');
const { group } = await import('$lib/server/db/schema/group');
const { bandSite } = await import('$lib/server/db/schema/band-site');

const NOW = new Date('2026-10-15T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const OLD = daysAgo(90);

beforeEach(() => {
	sqlite.exec('DELETE FROM band_site; DELETE FROM "group"');
});

const g = (id: string, over: Partial<typeof group.$inferInsert> = {}) => ({
	id,
	name: id,
	slug: id,
	kind: 'band' as const,
	createdAt: OLD,
	...over
});

describe('getBandTotals', () => {
	it('is all zeros with no bands', async () => {
		expect(await getBandTotals(NOW)).toEqual({ active: 0, premium: 0, newBands: 0 });
	});

	it('counts active bands only, and ignores clubs and committees', async () => {
		await testDb
			.insert(group)
			.values([
				g('band'),
				g('premium-band'),
				g('gone-premium', { deletedAt: OLD }),
				g('club', { kind: 'club' }),
				g('committee', { kind: 'committee', createdAt: daysAgo(1) })
			]);
		await testDb.insert(bandSite).values([
			{ groupId: 'premium-band', tier: 'premium' },
			{ groupId: 'gone-premium', tier: 'premium' },
			{ groupId: 'band', tier: 'free' }
		]);
		expect(await getBandTotals(NOW)).toEqual({ active: 2, premium: 1, newBands: 0 });
	});

	it('counts active bands created in the last thirty days as new', async () => {
		await testDb
			.insert(group)
			.values([
				g('today', { createdAt: daysAgo(0) }),
				g('29-days', { createdAt: daysAgo(29) }),
				g('31-days', { createdAt: daysAgo(31) }),
				g('new-but-gone', { createdAt: daysAgo(1), deletedAt: NOW })
			]);
		expect(await getBandTotals(NOW)).toEqual({ active: 3, premium: 0, newBands: 2 });
	});
});
