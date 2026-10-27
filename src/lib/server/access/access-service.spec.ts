import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The access dashboard's reads (#1942), against a real SQLite: who holds what
 * is joins and filters a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$app/server', () => ({ getRequestEvent: () => ({ locals: {} }) }));

const {
	getAccessSummary,
	getPersonAccess,
	listCapabilityHolders,
	listClearanceHolders,
	isLapsing
} = await import('./access-service');
const { role, modelHasRole } = await import('$lib/server/db/schema/authorization');
const { user } = await import('$lib/server/db/schema/authentication');
const { group, groupMember, groupCapability } = await import('$lib/server/db/schema/group');
const { volunteerCertification, memberCertification } =
	await import('$lib/server/db/schema/volunteer');

const DAY = 86_400_000;
const now = new Date();

beforeEach(async () => {
	for (const t of [
		'member_certification',
		'volunteer_certification',
		'group_capability',
		'group_member',
		'"group"',
		'model_has_roles',
		'roles',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	await testDb.insert(user).values(
		['ada', 'bo', 'cy', 'di', 'gone'].map((n) => ({
			id: `u-${n}`,
			name: n.toUpperCase(),
			email: `${n}@example.com`,
			emailVerified: false,
			deletedAt: n === 'gone' ? new Date() : null
		})) as never
	);
	await testDb
		.insert(role)
		.values(
			['admin', 'staff', 'treasurer', 'member'].map((name, i) => ({ id: i + 1, name })) as never
		);
	await testDb.insert(modelHasRole).values([
		{ roleId: 1, userId: 'u-ada' },
		{ roleId: 2, userId: 'u-bo' },
		{ roleId: 3, userId: 'u-cy' },
		{ roleId: 4, userId: 'u-di' },
		// A deleted account holds nothing worth counting.
		{ roleId: 1, userId: 'u-gone' }
	]);
	await testDb.insert(group).values([
		{ id: 'g-dev', kind: 'committee', name: 'Development', slug: 'development' },
		{ id: 'g-club', kind: 'club', name: 'Jazz', slug: 'jazz' }
	] as never);
	await testDb.insert(groupCapability).values([
		{ groupId: 'g-dev', capability: 'sponsor.manage' },
		{ groupId: 'g-dev', capability: 'project.manage' }
	]);
	await testDb.insert(groupMember).values([
		{ id: 'gm-1', groupId: 'g-dev', userId: 'u-di', role: 'admin', status: 'active' },
		{ id: 'gm-2', groupId: 'g-dev', userId: 'u-cy', role: 'member', status: 'inactive' },
		{ id: 'gm-3', groupId: 'g-club', userId: 'u-di', role: 'member', status: 'active' }
	] as never);
	await testDb
		.insert(volunteerCertification)
		.values({ id: 'vc-food', name: 'Food handler' } as never);
	await testDb.insert(memberCertification).values([
		{
			id: 'mc-1',
			userId: 'u-di',
			certificationId: 'vc-food',
			grantedAt: new Date(now.getTime() - 300 * DAY),
			expiresAt: new Date(now.getTime() + 10 * DAY)
		},
		{
			id: 'mc-2',
			userId: 'u-cy',
			certificationId: 'vc-food',
			grantedAt: new Date(now.getTime() - 300 * DAY),
			expiresAt: new Date(now.getTime() + 20 * DAY),
			revokedAt: new Date(now.getTime() - DAY),
			revokedReason: 'Left'
		},
		{
			id: 'mc-3',
			userId: 'u-bo',
			certificationId: 'vc-food',
			grantedAt: new Date(now.getTime() - 300 * DAY),
			expiresAt: new Date(now.getTime() + 200 * DAY)
		}
	] as never);
});

describe('getAccessSummary', () => {
	it('counts live position holders and only in-force clearances lapsing within 30 days', async () => {
		expect(await getAccessSummary(now)).toEqual({
			admins: 1,
			staff: 1,
			positionsHeld: 3,
			lapsingSoon: 1
		});
	});
});

describe('getPersonAccess', () => {
	it('names the seat, chair status and committee grants, ignoring clubs and legacy roles', async () => {
		const access = await getPersonAccess('u-di');
		expect(access.positions).toEqual([]);
		expect(access.capabilities).toEqual([]);
		expect(access.seats).toEqual([
			{
				groupId: 'g-dev',
				name: 'Development',
				chair: true,
				grants: expect.arrayContaining(['sponsor.manage', 'project.manage'])
			}
		]);
		expect(access.clearances.map((c) => c.id)).toEqual(['mc-1']);
	});

	it("expands a position into the matrix's capabilities", async () => {
		const access = await getPersonAccess('u-cy');
		expect(access.positions).toEqual(['treasurer']);
		expect(access.capabilities).toContain('finance.refund');
		expect(access.capabilities).not.toContain('user.setRole');
		// An inactive seat grants nothing.
		expect(access.seats).toEqual([]);
	});
});

describe('listCapabilityHolders', () => {
	it('joins position holders and active committee members, each with its source', async () => {
		const result = await listCapabilityHolders('sponsor.manage');
		const byName = Object.fromEntries(result.holders.map((h) => [h.member.title, h.sources]));
		expect(byName).toEqual({
			ADA: ['Administrator'],
			BO: ['Staff'],
			DI: ['Development (org-wide)']
		});
		expect(result.committees).toEqual([
			{
				groupId: 'g-dev',
				name: 'Development',
				held: expect.arrayContaining(['sponsor.manage', 'project.manage'])
			}
		]);
	});

	it('marks an owned-records grant as such and leaves out a capability no committee may carry', async () => {
		const owned = await listCapabilityHolders('project.manage');
		expect(owned.holders.find((h) => h.member.title === 'DI')?.sources).toEqual([
			'Development (on its own records)'
		]);
		const adminOnly = await listCapabilityHolders('user.setRole');
		expect(adminOnly.holders.map((h) => h.member.title)).toEqual(['ADA']);
		expect(adminOnly.committees).toEqual([]);
	});
});

describe('listClearanceHolders', () => {
	it('keeps revoked grants and flags only the in-force one lapsing soon', async () => {
		const rows = await listClearanceHolders('vc-food', now);
		const byId = Object.fromEntries(rows.map((r) => [r.id, [r.state, r.lapsing]]));
		expect(byId['mc-1']).toEqual(['expiring', true]);
		expect(byId['mc-2']).toEqual(['revoked', false]);
		expect(byId['mc-3']).toEqual(['current', false]);
	});

	it('isLapsing ignores a clearance with no expiry', () => {
		expect(isLapsing({ state: 'current', expiresAt: null }, now)).toBe(false);
	});
});
