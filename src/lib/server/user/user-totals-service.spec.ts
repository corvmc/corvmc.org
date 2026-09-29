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

describe('getUserTotals', () => {
	it('is all zeros with no accounts', async () => {
		expect(await getUserTotals()).toEqual({ total: 0, active: 0, sustaining: 0, deactivated: 0 });
	});

	it('splits accounts by deactivation and counts active sustaining members only', async () => {
		await testDb
			.insert(user)
			.values([
				u('plain'),
				u('sustainer', { subscription: SUB }),
				u('lapsed-sustainer', { subscription: SUB, deletedAt: GONE }),
				u('deactivated', { deletedAt: GONE }),
				u('banned', { deletedAt: GONE, bannedAt: GONE, banReason: 'x' })
			]);

		expect(await getUserTotals()).toEqual({
			total: 5,
			active: 2,
			sustaining: 1,
			deactivated: 3
		});
	});
});
