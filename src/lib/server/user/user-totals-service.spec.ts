import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { getUserTotals } = await import('./user-totals-service');
const { user } = await import('$lib/server/db/schema/authentication');

const SUB = { status: 'active' } as never;
const GONE = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
	sqlite.exec('DELETE FROM user');
});

const u = (id: string, over: Partial<typeof user.$inferInsert> = {}) => ({
	id,
	name: id,
	email: `${id}@example.com`,
	emailVerified: false,
	...over
});

const NOW = new Date('2026-10-15T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('getUserTotals', () => {
	it('is all zeros with no accounts', async () => {
		expect(await getUserTotals(NOW)).toEqual({ accounts: 0, sustaining: 0, newMembers: 0 });
	});

	it('counts active accounts only, and active sustaining members only', async () => {
		await testDb
			.insert(user)
			.values([
				u('plain', { createdAt: daysAgo(30) }),
				u('sustainer', { subscription: SUB, createdAt: daysAgo(30) }),
				u('lapsed-sustainer', { subscription: SUB, deletedAt: GONE, createdAt: daysAgo(30) }),
				u('deactivated', { deletedAt: GONE, createdAt: daysAgo(30) }),
				u('banned', { deletedAt: GONE, bannedAt: GONE, banReason: 'x', createdAt: daysAgo(30) })
			]);

		expect(await getUserTotals(NOW)).toEqual({ accounts: 2, sustaining: 1, newMembers: 0 });
	});

	it('counts active accounts that joined in the last seven days as new members', async () => {
		await testDb
			.insert(user)
			.values([
				u('today', { createdAt: daysAgo(0) }),
				u('six-days', { createdAt: daysAgo(6) }),
				u('eight-days', { createdAt: daysAgo(8) }),
				u('new-but-deactivated', { createdAt: daysAgo(1), deletedAt: GONE })
			]);

		expect(await getUserTotals(NOW)).toMatchObject({ accounts: 3, newMembers: 2 });
	});
});
