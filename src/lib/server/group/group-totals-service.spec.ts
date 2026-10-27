import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { getClubTotals } = await import('./group-totals-service');
const { user } = await import('$lib/server/db/schema/authentication');
const { group, groupMember } = await import('$lib/server/db/schema/group');
const { groupApplication, groupApplicationChoice } =
	await import('$lib/server/db/schema/group-application');

const GONE = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
	sqlite.exec(
		'DELETE FROM group_application_choice; DELETE FROM group_application; DELETE FROM group_member; DELETE FROM "group"; DELETE FROM user'
	);
});

const u = (id: string, over: Partial<typeof user.$inferInsert> = {}) => ({
	id,
	name: id,
	email: `${id}@example.com`,
	emailVerified: false,
	...over
});

describe('getClubTotals', () => {
	it('is all zeros with no clubs', async () => {
		expect(await getClubTotals()).toEqual({ clubs: 0, members: 0, applications: 0 });
	});

	it('counts active clubs, distinct active club members and open club applications', async () => {
		await testDb.insert(user).values([u('a'), u('b'), u('c'), u('gone', { deletedAt: GONE })]);
		await testDb.insert(group).values([
			{ id: 'jazz', kind: 'club', name: 'Jazz', slug: 'jazz' },
			{ id: 'folk', kind: 'club', name: 'Folk', slug: 'folk' },
			{ id: 'old', kind: 'club', name: 'Old', slug: 'old', deletedAt: GONE },
			{ id: 'band', kind: 'band', name: 'Band', slug: 'band' }
		]);
		await testDb.insert(groupMember).values([
			{ groupId: 'jazz', userId: 'a', role: 'member', status: 'active' },
			{ groupId: 'folk', userId: 'a', role: 'member', status: 'active' },
			{ groupId: 'folk', userId: 'b', role: 'member', status: 'pending' },
			{ groupId: 'old', userId: 'c', role: 'member', status: 'active' },
			{ groupId: 'band', userId: 'c', role: 'member', status: 'active' }
		]);
		await testDb.insert(groupApplication).values([
			{ id: 'app-b', userId: 'b' },
			{ id: 'app-c', userId: 'c' },
			{ id: 'app-withdrawn', userId: 'a', withdrawnAt: GONE },
			{ id: 'app-gone', userId: 'gone' }
		]);
		await testDb.insert(groupApplicationChoice).values([
			{ applicationId: 'app-b', groupId: 'jazz', status: 'submitted' },
			{ applicationId: 'app-b', groupId: 'folk', status: 'contacted' },
			{ applicationId: 'app-c', groupId: 'jazz', status: 'declined' },
			{ applicationId: 'app-c', groupId: 'old', status: 'submitted' },
			{ applicationId: 'app-withdrawn', groupId: 'jazz', status: 'submitted' },
			{ applicationId: 'app-gone', groupId: 'folk', status: 'submitted' }
		]);

		expect(await getClubTotals()).toEqual({ clubs: 2, members: 1, applications: 2 });
	});
});
