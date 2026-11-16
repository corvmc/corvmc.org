import { describe, it, expect, vi, beforeEach } from 'vitest';

// The aggregates run in SQL (json_extract over the subscription snapshot), so
// they run against a real SQLite. KV is the outside service.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

let kvStore: Record<string, string> = {};
vi.mock('#lib/server/kv.js', () => ({
	getJson: vi.fn(async (key: string) => {
		const val = kvStore[key];
		return val ? JSON.parse(val) : null;
	}),
	putJson: vi.fn(async (key: string, value: unknown) => {
		kvStore[key] = JSON.stringify(value);
	}),
	deleteKey: vi.fn(async (key: string) => {
		delete kvStore[key];
	})
}));

const { getCommunityStats } = await import('./community-stats');

let n = 0;
function member(opts: { hoursPerReset?: number; deleted?: boolean } = {}) {
	n++;
	sqlite
		.prepare(`insert into user (id, name, email, subscription, deleted_at) values (?, ?, ?, ?, ?)`)
		.run(
			`u${n}`,
			`User ${n}`,
			`u${n}@example.com`,
			opts.hoursPerReset === undefined
				? null
				: JSON.stringify({ hoursPerReset: opts.hoursPerReset }),
			opts.deleted ? 1_750_000_000 : null
		);
}

describe('getCommunityStats', () => {
	beforeEach(() => {
		kvStore = {};
		n = 0;
		sqlite.exec('delete from user');
	});

	it('aggregates sustaining members and their credits, ignoring deleted accounts', async () => {
		member({ hoursPerReset: 20 });
		member({ hoursPerReset: 27 });
		member();
		member();
		member({ hoursPerReset: 100, deleted: true });
		member({ deleted: true });

		const stats = await getCommunityStats();

		expect(stats.sustainingMemberCount).toBe(2);
		// hoursPerReset is in credits (30-min blocks); reported as hours = 47 / 2.
		expect(stats.totalFreeHoursAllocated).toBe(23.5);
		expect(stats.participationPercent).toBe(50);
	});

	it('returns zeros when no data exists', async () => {
		expect(await getCommunityStats()).toEqual({
			sustainingMemberCount: 0,
			totalFreeHoursAllocated: 0,
			participationPercent: 0
		});
	});

	it('returns cached results from KV without re-querying', async () => {
		kvStore['community-stats'] = JSON.stringify({
			sustainingMemberCount: 5,
			totalFreeHoursAllocated: 20,
			participationPercent: 10
		});
		member({ hoursPerReset: 4 });

		expect((await getCommunityStats()).sustainingMemberCount).toBe(5);
	});

	it('stores result in KV after querying', async () => {
		member({ hoursPerReset: 30 });
		for (let i = 0; i < 4; i++) member();

		await getCommunityStats();

		expect(JSON.parse(kvStore['community-stats'])).toEqual({
			sustainingMemberCount: 1,
			totalFreeHoursAllocated: 15,
			participationPercent: 20
		});
	});
});
