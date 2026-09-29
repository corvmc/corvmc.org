import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Who hears about an application (#1726), against a real SQLite: which roster
 * rows count as a reviewer is a `WHERE` clause a mocked `db` would pass either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const holders = vi.fn(async (_cap: string) => [
	{ id: 'usr-coord', name: 'Coordinator', email: 'coord@example.com' }
]);
vi.mock('$lib/server/authorization', () => ({
	listUsersWithCapability: (cap: string) => holders(cap)
}));

const { applicationNotice } = await import('./application-reviewers');

const CLUB = 'grp-club';
const COMMITTEE = 'grp-committee';

async function member(id: string, groupId: string, userId: string, role: string, status: string) {
	const { groupMember } = await import('$lib/server/db/schema/group');
	await testDb.insert(groupMember).values({ id, groupId, userId, role, status } as never);
}

beforeEach(async () => {
	holders.mockClear();
	for (const t of ['group_member', '"group"', 'user']) sqlite.exec(`delete from ${t}`);
	const { user } = await import('$lib/server/db/schema/authentication');
	const { group } = await import('$lib/server/db/schema/group');
	await testDb.insert(user).values(
		['applicant', 'owner', 'admin', 'plain', 'invited'].map((n) => ({
			id: `usr-${n}`,
			name: n[0].toUpperCase() + n.slice(1),
			email: `${n}@example.com`,
			emailVerified: false
		})) as never
	);
	await testDb.insert(group).values([
		{ id: CLUB, kind: 'club', name: 'Jazz Club', slug: 'jazz-club' },
		{ id: COMMITTEE, kind: 'committee', name: 'Booking Committee', slug: 'booking-committee' }
	] as never);
});

describe('applicationNotice', () => {
	it('names the active owner and admins of a club, and nobody else on the roster', async () => {
		await member('gm-1', CLUB, 'usr-owner', 'owner', 'active');
		await member('gm-2', CLUB, 'usr-admin', 'admin', 'active');
		await member('gm-3', CLUB, 'usr-plain', 'member', 'active');
		await member('gm-4', CLUB, 'usr-invited', 'admin', 'pending');

		const notice = await applicationNotice(CLUB, 'usr-applicant');

		expect(notice?.groupName).toBe('Jazz Club');
		expect(notice?.applicantName).toBe('Applicant');
		expect(notice?.reviewers.map((r) => r.id).sort()).toEqual(['usr-admin', 'usr-owner']);
		expect(notice?.reviewers.every((r) => r.href === '/member/groups/jazz-club')).toBe(true);
		expect(holders).not.toHaveBeenCalled();
	});

	it('sends a chaired committee to its chair alone', async () => {
		await member('gm-5', COMMITTEE, 'usr-owner', 'owner', 'active');

		const notice = await applicationNotice(COMMITTEE, 'usr-applicant');

		expect(notice?.reviewers.map((r) => r.id)).toEqual(['usr-owner']);
		expect(holders).not.toHaveBeenCalled();
	});

	it('sends a headless committee to the coordinator, at the staff queue', async () => {
		await member('gm-6', COMMITTEE, 'usr-plain', 'member', 'active');

		const notice = await applicationNotice(COMMITTEE, 'usr-applicant');

		expect(holders).toHaveBeenCalledWith('committee.reviewApplications');
		expect(notice?.reviewers).toEqual([
			{
				id: 'usr-coord',
				name: 'Coordinator',
				email: 'coord@example.com',
				href: '/staff/committees'
			}
		]);
	});

	it('leaves a headless club unannounced rather than guessing', async () => {
		const notice = await applicationNotice(CLUB, 'usr-applicant');
		expect(notice?.reviewers).toEqual([]);
		expect(holders).not.toHaveBeenCalled();
	});

	it('returns null for a group that is gone', async () => {
		expect(await applicationNotice('grp-missing', 'usr-applicant')).toBeNull();
	});
});
