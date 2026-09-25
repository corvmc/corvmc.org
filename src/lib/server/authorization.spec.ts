import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mock the db module with a chainable query builder
// ---------------------------------------------------------------------------
let queryResults: unknown[] = [];
/** Predicates passed to `.where()`, so they can be rendered to real SQL below. */
const whereClauses: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				// Make the chain awaitable — resolve with current queryResults
				return (resolve: (v: unknown[]) => void) => resolve(queryResults);
			}
			if (prop === 'where') {
				return (clause: unknown) => {
					whereClauses.push(clause);
					return proxy;
				};
			}
			// Any method call returns the proxy so chaining works
			return () => proxy;
		}
	});
	return proxy;
}

/** How many times `db.select()` was called — the memo test's whole assertion. */
export const selectCalls = { n: 0 };

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => {
			selectCalls.n++;
			return chainable();
		},
		insert: () => chainable(),
		update: () => chainable(),
		delete: () => chainable()
	}
}));

// A mutable request event. `locals` is replaced per test; `positions` is the
// per-request memo the guards write into, so a fresh object per test is what
// makes the memo assertions meaningful.
let locals: Record<string, unknown> = {};
vi.mock('$app/server', () => ({ getRequestEvent: () => ({ locals }) }));

// The grant resolver has its own spec; here only the order and the scoping matter.
const committeeGrantsFor = vi.fn(async (_userId: string) => [] as unknown[]);
const roleGrantAllows = vi.fn(async (..._args: unknown[]) => false);
const listCommitteeHolders = vi.fn(async (_cap: string) => [] as unknown[]);
vi.mock('$lib/server/capability/capability-grants', async (orig) => ({
	...(await orig<typeof import('$lib/server/capability/capability-grants')>()),
	committeeGrantsFor,
	roleGrantAllows,
	listCommitteeHolders
}));

// Import after mocking
const {
	getUserRoles,
	findStaffUserByEmail,
	positionsFor,
	capabilitySet,
	can,
	requireCapability,
	requireCapabilityOrOwner,
	userHasCapability,
	isElevated,
	listUsersWithCapability,
	committeeCapabilitiesFor
} = await import('./authorization');

// drizzle and the schema are real, so the predicate the service builds can be
// rendered to actual SQL and asserted on rather than taken on faith.
const dialect = new SQLiteSyncDialect();
const renderWhere = (index: number) => dialect.sqlToQuery(whereClauses[index] as SQL).sql;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('getUserRoles', () => {
	it('returns role names for the user', async () => {
		queryResults = [{ name: 'admin' }, { name: 'staff' }];

		const roles = await getUserRoles('user-123');
		expect(roles).toEqual(['admin', 'staff']);
	});

	it('returns empty array when user has no roles', async () => {
		queryResults = [];

		const roles = await getUserRoles('user-123');
		expect(roles).toEqual([]);
	});
});

describe('findStaffUserByEmail', () => {
	beforeEach(() => {
		queryResults = [];
		whereClauses.length = 0;
	});

	it('returns the staff user behind an address', async () => {
		queryResults = [{ id: 'staff-1', name: 'Ada', email: 'ada@corvmc.org' }];

		await expect(findStaffUserByEmail('ada@corvmc.org')).resolves.toEqual({
			id: 'staff-1',
			name: 'Ada',
			email: 'ada@corvmc.org'
		});
	});

	it('returns null when the address belongs to nobody with a staff role', async () => {
		queryResults = [];

		await expect(findStaffUserByEmail('stranger@example.com')).resolves.toBeNull();
	});

	it('matches case-insensitively, since no mail client normalises From', async () => {
		// SQLite compares TEXT with `=` case-sensitively, so the lower() is what
		// stops `Ada@corvmc.org` on an envelope being treated as a stranger.
		await findStaffUserByEmail('  Ada@CorvMC.org ');

		expect(renderWhere(0)).toContain('lower(');
	});

	it('only ever matches a role that names a position', async () => {
		// Derived from positionOrder rather than a hardcoded pair, so a new
		// position is recognised as staff mail without touching this query — and
		// a legacy `member` row never is.
		const { positionOrder } = await import('$lib/config');
		await findStaffUserByEmail('ada@corvmc.org');

		const placeholders = positionOrder.map(() => '?').join(', ');
		expect(renderWhere(0)).toContain(`"roles"."name" in (${placeholders})`);
	});

	it('skips the query entirely for a blank address', async () => {
		await expect(findStaffUserByEmail('   ')).resolves.toBeNull();

		expect(whereClauses).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Capabilities
//
// The guards name a capability and the matrix in $lib/config decides. These
// pin the three things that are easy to get wrong and impossible to see:
// that the pure inverter in config agrees with better-auth's evaluator, that
// legacy role rows are not mistaken for positions, and that the per-request
// memo is a cached PROMISE rather than a cached value.
// ---------------------------------------------------------------------------

const asUser = (id = 'u-1') => {
	locals = { user: { id } };
};

beforeEach(() => {
	queryResults = [];
	selectCalls.n = 0;
	locals = {};
	committeeGrantsFor.mockReset().mockResolvedValue([]);
	roleGrantAllows.mockReset().mockResolvedValue(false);
	listCommitteeHolders.mockReset().mockResolvedValue([]);
});

describe('positionsFor', () => {
	it('keeps only names that are actually positions', async () => {
		// `roles` still carries member/sustaining/volunteer rows that grant
		// nothing. Treating one as a position would hand it the matrix's default.
		queryResults = [
			{ name: 'staff' },
			{ name: 'member' },
			{ name: 'sustaining' },
			{ name: 'volunteer' }
		];
		expect(await positionsFor('u-1')).toEqual(['staff']);
	});

	it('returns nothing for a user holding only legacy rows', async () => {
		queryResults = [{ name: 'member' }];
		expect(await positionsFor('u-1')).toEqual([]);
	});
});

describe('can', () => {
	it('is false with no authenticated user, without touching the db', async () => {
		expect(await can('user.list')).toBe(false);
		expect(selectCalls.n).toBe(0);
	});

	it('grants a treasurer their own domain and nothing else', async () => {
		asUser();
		queryResults = [{ name: 'treasurer' }];
		expect(await can('finance.refund')).toBe(true);
		expect(await can('credit.read')).toBe(true);
		// The admin-only complement.
		expect(await can('credit.adjust')).toBe(false);
		expect(await can('user.purge')).toBe(false);
		expect(await can('volunteer.reviewHours')).toBe(false);
	});

	it('unions two positions rather than picking one', async () => {
		// Positions are unranked, so holding two must grant both domains — and
		// must not grant something neither holds.
		asUser();
		queryResults = [{ name: 'treasurer' }, { name: 'site_moderator' }];
		expect(await can('finance.refund')).toBe(true);
		expect(await can('moderation.setStanding')).toBe(true);
		expect(await can('volunteer.manageRoles')).toBe(false);
	});

	it('no longer lets staff grant a role, purge an account, or move credit', async () => {
		// The narrowing, seen from the guard rather than the matrix. These three
		// are the whole behavioural change of the migration: a staff holder could
		// previously grant themselves admin, which is the defect the spec opens on.
		asUser();
		queryResults = [{ name: 'staff' }];
		expect(await can('user.setRole')).toBe(false);
		expect(await can('user.purge')).toBe(false);
		expect(await can('credit.adjust')).toBe(false);
	});

	it('leaves staff everything else, including settings', async () => {
		// Narrowing is not demotion. `settings.update` in particular stays: it is
		// the Technology Coordinator's job description, so by the spec's own rule
		// (admin-only is the complement of every position's domain) it cannot be
		// admin-only, whatever the spec's illustrative table said.
		asUser();
		queryResults = [{ name: 'staff' }];
		expect(await can('settings.update')).toBe(true);
		expect(await can('user.deactivate')).toBe(true);
		expect(await can('credit.read')).toBe(true);
		expect(await can('volunteer.reviewHours')).toBe(true);
	});

	it('still gives admin the complement', async () => {
		asUser();
		queryResults = [{ name: 'admin' }];
		expect(await can('user.setRole')).toBe(true);
		expect(await can('user.purge')).toBe(true);
		expect(await can('credit.adjust')).toBe(true);
	});
});

describe('grants beyond positions', () => {
	const devSeat = [{ groupId: 'dev', capabilities: ['sponsor.manage'] }];

	it('checks positions first and reads no grants when a position suffices', async () => {
		asUser();
		queryResults = [{ name: 'staff' }];
		expect(await can('sponsor.manage')).toBe(true);
		expect(committeeGrantsFor).not.toHaveBeenCalled();
	});

	it('reads no grants for a capability off the allowlist', async () => {
		asUser();
		committeeGrantsFor.mockResolvedValue([{ groupId: 'dev', capabilities: ['finance.refund'] }]);
		expect(await can('finance.refund')).toBe(false);
		expect(await can('user.ban', { eventId: 'ev-1' })).toBe(false);
		expect(committeeGrantsFor).not.toHaveBeenCalled();
		expect(roleGrantAllows).not.toHaveBeenCalled();
	});

	it('allows a committee member an org-wide grant with no scope', async () => {
		asUser('u-7');
		committeeGrantsFor.mockResolvedValue(devSeat);
		expect(await can('sponsor.manage')).toBe(true);
		await expect(requireCapability('sponsor.manage')).resolves.toMatchObject({ id: 'u-7' });
		expect(committeeGrantsFor).toHaveBeenCalledTimes(1);
	});

	it('denies a committee member what their committee does not carry', async () => {
		asUser();
		committeeGrantsFor.mockResolvedValue(devSeat);
		await expect(requireCapability('grant.manage')).rejects.toMatchObject({ status: 403 });
	});

	it('asks the role resolver only when an event is named', async () => {
		asUser('u-3');
		roleGrantAllows.mockResolvedValue(true);
		expect(await can('event.uploadRecap')).toBe(false);
		expect(roleGrantAllows).not.toHaveBeenCalled();

		expect(await can('event.uploadRecap', { eventId: 'ev-1' })).toBe(true);
		expect(roleGrantAllows).toHaveBeenCalledWith('u-3', 'event.uploadRecap', 'ev-1');
	});

	it('403s a role grant for the wrong event or an expired window', async () => {
		// The resolver answers false for both; its own spec pins why.
		asUser();
		await expect(
			requireCapability('event.uploadRecap', { eventId: 'other-event' })
		).rejects.toMatchObject({ status: 403 });
	});

	it('lets a seat on a committee granted ballot.manage run member-wide ballots', async () => {
		asUser('gov-1');
		committeeGrantsFor.mockResolvedValue([{ groupId: 'gov', capabilities: ['ballot.manage'] }]);
		await expect(requireCapability('ballot.manage')).resolves.toMatchObject({ id: 'gov-1' });
		expect(await committeeCapabilitiesFor('gov-1')).toContain('ballot.manage');
	});

	it('refuses ballot.manage to a seat, or a role grant, that does not carry it', async () => {
		asUser();
		committeeGrantsFor.mockResolvedValue(devSeat);
		roleGrantAllows.mockResolvedValue(true);
		await expect(requireCapability('ballot.manage')).rejects.toMatchObject({ status: 403 });
		await expect(requireCapability('ballot.manage', { eventId: 'ev-1' })).rejects.toMatchObject({
			status: 403
		});
		expect(roleGrantAllows).not.toHaveBeenCalled();
	});

	it('extends userHasCapability the same way, without a request', async () => {
		queryResults = [];
		committeeGrantsFor.mockResolvedValue(devSeat);
		expect(await userHasCapability('u-1', 'sponsor.manage')).toBe(true);
		expect(await userHasCapability('u-1', 'user.purge')).toBe(false);
	});
});

describe('the per-request memo', () => {
	it('reads positions once across sequential checks', async () => {
		asUser();
		queryResults = [{ name: 'staff' }];
		await can('user.list');
		await can('user.read');
		await can('settings.read');
		expect(selectCalls.n).toBe(1);
	});

	it('reads positions once across CONCURRENT checks', async () => {
		// The reason the memo caches the promise and not the resolved array.
		// getMemberLayout and getBandLayout both fire their guards inside a
		// Promise.all; a value cache is only populated after the first read
		// settles, so all three would each start their own D1 read. This is the
		// only test that catches a regression to value caching.
		asUser();
		queryResults = [{ name: 'staff' }];
		await Promise.all([can('user.list'), can('user.read'), can('settings.read')]);
		expect(selectCalls.n).toBe(1);
	});

	it('does not leak across requests', async () => {
		asUser('u-1');
		queryResults = [{ name: 'treasurer' }];
		expect(await can('finance.refund')).toBe(true);

		asUser('u-2');
		queryResults = [{ name: 'site_moderator' }];
		expect(await can('finance.refund')).toBe(false);
		expect(await can('moderation.setStanding')).toBe(true);
	});
});

describe('requireCapability', () => {
	it('401s with no user', async () => {
		await expect(requireCapability('user.list')).rejects.toMatchObject({ status: 401 });
	});

	it('403s without the capability', async () => {
		asUser();
		queryResults = [{ name: 'treasurer' }];
		await expect(requireCapability('user.purge')).rejects.toMatchObject({ status: 403 });
	});

	it('returns the user when permitted', async () => {
		asUser('u-9');
		queryResults = [{ name: 'admin' }];
		await expect(requireCapability('user.purge')).resolves.toMatchObject({ id: 'u-9' });
	});
});

describe('requireCapabilityOrOwner', () => {
	it('short-circuits on ownership without reading the db', async () => {
		asUser('owner-1');
		expect(await requireCapabilityOrOwner('reservation.manage', 'owner-1')).toBe('owner');
		expect(selectCalls.n).toBe(0);
	});

	it('admits a capability holder as staff', async () => {
		asUser('u-1');
		queryResults = [{ name: 'admin' }];
		expect(await requireCapabilityOrOwner('reservation.manage', 'owner-1')).toBe('staff');
	});

	it('403s for a stranger', async () => {
		asUser('u-1');
		queryResults = [{ name: 'treasurer' }];
		await expect(
			requireCapabilityOrOwner('volunteer.manageRoles', 'owner-1')
		).rejects.toMatchObject({ status: 403 });
	});
});

describe('userHasCapability', () => {
	it('answers without a request event', async () => {
		// The form for event-bus listeners and cron. `locals` is deliberately
		// empty: reaching getRequestEvent() from there throws, and a listener
		// failure is swallowed by captureException, so it would fail silently.
		queryResults = [{ name: 'volunteer_coordinator' }];
		expect(await userHasCapability('u-1', 'volunteer.reviewHours')).toBe(true);
		expect(await userHasCapability('u-1', 'user.purge')).toBe(false);
	});
});

describe('isElevated', () => {
	it('is true for any position and false for legacy rows only', async () => {
		queryResults = [{ name: 'treasurer' }];
		expect(await isElevated('u-1')).toBe(true);
		queryResults = [{ name: 'member' }];
		expect(await isElevated('u-1')).toBe(false);
	});
});

describe('capabilitySet', () => {
	it('flattens to the dotted strings the client checks', async () => {
		const set = capabilitySet(['treasurer']);
		expect(set).toContain('finance.refund');
		expect(set).toContain('credit.read');
		expect(set).not.toContain('credit.adjust');
	});

	it('is the union for two positions, without duplicates', async () => {
		// Both grant user.list/user.read; the merge must not emit them twice.
		const set = capabilitySet(['treasurer', 'site_moderator']);
		expect(set.filter((c) => c === 'user.list')).toHaveLength(1);
		expect(set).toContain('moderation.reviewFlags');
		expect(set).toContain('finance.refund');
	});

	it('is empty for no positions', () => {
		expect(capabilitySet([])).toEqual([]);
	});
});

describe('listUsersWithCapability', () => {
	it('queries the positions that grant it, and de-duplicates holders', async () => {
		// A user holding two granting positions joins to two rows.
		queryResults = [
			{ id: 'u-1', name: 'A', email: 'a@example.com' },
			{ id: 'u-1', name: 'A', email: 'a@example.com' },
			{ id: 'u-2', name: 'B', email: 'b@example.com' }
		];
		const rows = await listUsersWithCapability('volunteer.reviewHours');
		expect(rows.map((r) => r.id)).toEqual(['u-1', 'u-2']);

		// The predicate names admin, staff and the volunteer coordinator — the
		// inversion is pure config, so the lookup stays one round trip.
		const sql = renderWhere(whereClauses.length - 1);
		expect(sql).toContain('in');
	});
});

describe('sponsors, grants and renewals through a committee seat (#1578, #1602)', () => {
	const DEVELOPMENT = [
		{
			groupId: 'dev',
			capabilities: [
				'sponsor.read',
				'sponsor.manage',
				'grant.read',
				'grant.manage',
				'renewal.read',
				'renewal.manage'
			]
		}
	];
	const CAPS = [
		'sponsor.read',
		'sponsor.manage',
		'grant.read',
		'grant.manage',
		'renewal.read',
		'renewal.manage'
	] as const;

	for (const cap of CAPS) {
		it(`admits a member of a committee granting ${cap}, holding no position`, async () => {
			asUser('dev-1');
			committeeGrantsFor.mockResolvedValue(DEVELOPMENT);
			await expect(requireCapability(cap)).resolves.toMatchObject({ id: 'dev-1' });
		});

		it(`refuses ${cap} to someone with neither a seat nor a position`, async () => {
			asUser();
			await expect(requireCapability(cap)).rejects.toMatchObject({ status: 403 });
		});
	}

	it('lets the treasurer read sponsors and grants without managing them', async () => {
		asUser();
		queryResults = [{ name: 'treasurer' }];
		expect(await can('sponsor.read')).toBe(true);
		expect(await can('grant.read')).toBe(true);
		expect(await can('sponsor.manage')).toBe(false);
		expect(await can('renewal.read')).toBe(false);
	});

	it('gives a seat nothing its committee does not carry', async () => {
		asUser();
		committeeGrantsFor.mockResolvedValue([{ groupId: 'dev', capabilities: ['sponsor.read'] }]);
		expect(await can('sponsor.manage')).toBe(false);
		expect(await can('project.manage')).toBe(false);
	});

	it('lists the seat among the capabilities the nav is built from', async () => {
		committeeGrantsFor.mockResolvedValue(DEVELOPMENT);
		expect(await committeeCapabilitiesFor('dev-1')).toEqual(expect.arrayContaining([...CAPS]));
	});

	it('counts committee members among the holders, once each', async () => {
		queryResults = [{ id: 'u-1', name: 'A', email: 'a@x' }];
		listCommitteeHolders.mockResolvedValue([
			{ id: 'u-1', name: 'A', email: 'a@x' },
			{ id: 'dev-1', name: 'D', email: 'd@x' }
		]);
		const rows = await listUsersWithCapability('renewal.manage');
		expect(rows.map((r) => r.id)).toEqual(['u-1', 'dev-1']);
		expect(listCommitteeHolders).toHaveBeenCalledWith('renewal.manage');
	});
});

describe('config and better-auth agree', () => {
	it('grants the same capabilities from both evaluators', async () => {
		// config.ts cannot import better-auth (it is client-bundled), so
		// `grantsCapability` re-implements the decision that `authorize()` makes.
		// This is the test that stops the two drifting apart.
		const { capabilities, positions, positionOrder, grantsCapability, positionsGranting } =
			await import('$lib/config');

		const every = Object.entries(capabilities).flatMap(([r, actions]) =>
			(actions as readonly string[]).map((a) => `${r}.${a}` as never)
		);

		for (const cap of every) {
			const fromConfig = positionOrder.filter((p) => grantsCapability(positions[p], cap));
			expect(positionsGranting(cap), String(cap)).toEqual(fromConfig);

			for (const p of positionOrder) {
				// capabilitySet runs through better-auth's Role; config decides
				// independently. They must agree for every position/capability pair.
				const viaLibrary = capabilitySet([p]).includes(cap);
				expect(viaLibrary, `${p} / ${cap}`).toBe(grantsCapability(positions[p], cap));
			}
		}
	});
});
