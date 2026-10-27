import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { getUserTotals, userListWhere } = await import('./user-totals-service');
const { user } = await import('$lib/server/db/schema/authentication');
const { group, groupMember } = await import('$lib/server/db/schema/group');
const { role, modelHasRole } = await import('$lib/server/db/schema/authorization');
const { instructor } = await import('$lib/server/db/schema/instructor');

const SUB = { status: 'active' } as never;
const GONE = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
	sqlite.exec(
		'DELETE FROM group_member; DELETE FROM "group"; DELETE FROM instructor; DELETE FROM model_has_roles; DELETE FROM roles; DELETE FROM user'
	);
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

describe('userListWhere', () => {
	const ids = async (filters: Parameters<typeof userListWhere>[0]) =>
		(await testDb.select({ id: user.id }).from(user).where(userListWhere(filters)))
			.map((r) => r.id)
			.sort();

	beforeEach(async () => {
		await testDb
			.insert(user)
			.values([
				u('plain'),
				u('sustainer', { subscription: SUB }),
				u('bandmate'),
				u('pending-bandmate'),
				u('clubber'),
				u('staffer'),
				u('teacher'),
				u('paused-teacher'),
				u('gone', { deletedAt: GONE })
			]);
		await testDb.insert(group).values([
			{ id: 'b', kind: 'band', name: 'B', slug: 'b' },
			{ id: 'c', kind: 'club', name: 'C', slug: 'c' }
		]);
		await testDb.insert(groupMember).values([
			{ groupId: 'b', userId: 'bandmate', role: 'member', status: 'active' },
			{ groupId: 'b', userId: 'pending-bandmate', role: 'member', status: 'pending' },
			{ groupId: 'c', userId: 'clubber', role: 'member', status: 'active' }
		]);
		const [r] = await testDb.insert(role).values({ name: 'staff' }).returning();
		await testDb.insert(modelHasRole).values({ roleId: r.id, userId: 'staffer' });
		await testDb.insert(instructor).values([
			{ userId: 'teacher', status: 'active' },
			{ userId: 'paused-teacher', status: 'paused' }
		]);
	});

	it('defaults to active accounts', async () => {
		expect(await ids({})).not.toContain('gone');
		expect(await ids({ status: 'all' })).toContain('gone');
		expect(await ids({ status: 'deactivated' })).toEqual(['gone']);
	});

	it('filters sustaining members both ways, by the predicate the totals count', async () => {
		expect(await ids({ sustaining: true })).toEqual(['sustainer']);
		expect(await ids({ sustaining: false })).not.toContain('sustainer');
		expect((await getUserTotals(NOW)).sustaining).toBe((await ids({ sustaining: true })).length);
	});

	it('counts an active band seat as in a band, not a pending one or a club', async () => {
		expect(await ids({ inBand: true })).toEqual(['bandmate']);
		expect(await ids({ inBand: false })).toContain('pending-bandmate');
		expect(await ids({ inBand: false })).toContain('clubber');
	});

	it('filters staff positions and teaching instructors', async () => {
		expect(await ids({ staff: true })).toEqual(['staffer']);
		expect(await ids({ instructor: true })).toEqual(['teacher']);
	});

	it('combines search with the other filters', async () => {
		expect(await ids({ search: 'band', inBand: true })).toEqual(['bandmate']);
		expect(await ids({ search: 'nobody' })).toEqual([]);
	});
});
