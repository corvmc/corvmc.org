import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let insertResult: unknown[] = [];
let updateCalled = false;

function buildChain(getResult: () => unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(getResult());
			}
			return () => proxy;
		}
	});
	return proxy;
}

let selectCallIndex = 0;
const selectResults: unknown[][] = [];

vi.mock('$lib/server/db', () => ({
	db: {
		select: () =>
			buildChain(() => {
				const result = selectResults[selectCallIndex] ?? [];
				selectCallIndex++;
				return result;
			}),
		insert: () => ({
			values: (row: unknown) => {
				insertResult.push(row);
				// `createInvite` upserts; `resolvePendingInvites` awaits the values()
				// result directly. One chainable object serves both.
				const chain = {
					onConflictDoUpdate: () => chain,
					returning: () =>
						Promise.resolve([{ id: 'inv-new', token: 'tok-abc', ...(row as object) }])
				};
				return chain;
			}
		}),
		update: () => {
			updateCalled = true;
			return buildChain(() => []);
		}
	}
}));

vi.mock('$lib/server/db/schema/group-invite', () => ({
	groupInvite: {
		id: 'id',
		email: 'email',
		groupId: 'group_id',
		role: 'role',
		position: 'position',
		status: 'status',
		token: 'token',
		expiresAt: 'expires_at',
		createdAt: 'created_at',
		invitedById: 'invited_by_id',
		acceptedAt: 'accepted_at'
	}
}));

vi.mock('$lib/server/db/schema/group', () => ({
	group: { id: 'id', name: 'name', kind: 'kind' },
	groupMember: {
		id: 'id',
		groupId: 'group_id',
		userId: 'user_id',
		role: 'role',
		position: 'position',
		status: 'status',
		invitedById: 'invited_by_id'
	}
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'id', name: 'name', email: 'email' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	gt: vi.fn(),
	desc: vi.fn(),
	sql: (strings: TemplateStringsArray) => strings.join('')
}));

const mockInvite = vi.fn().mockResolvedValue({ id: 'member-1' });
// `isUniqueConstraintError` deliberately is NOT mocked — it lives in
// $lib/server/db/constraint-errors (no schema imports) so these tests run the
// real predicate rather than a stub that would prove nothing.
vi.mock('$lib/server/band/band-service', () => ({
	invite: (...args: unknown[]) => mockInvite(...args),
	BandMemberExistsError: class BandMemberExistsError extends Error {
		constructor(message = 'exists') {
			super(message);
			this.name = 'BandMemberExistsError';
		}
	}
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: mockEmit }
}));

const {
	createInvite,
	resolvePendingInvites,
	listForGroup,
	revoke,
	getByToken,
	GroupInviteNotFoundError,
	GroupInviteNotPendingError
} = await import('./group-invite-service');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	selectCallIndex = 0;
	selectResults.length = 0;
	insertResult = [];
	updateCalled = false;
});

describe('createInvite', () => {
	it('delegates to band-service invite when user already exists', async () => {
		// select 1: user lookup — found
		selectResults.push([{ id: 'user-existing' }]);

		const result = await createInvite(
			'Alice@Example.COM',
			'band-1',
			'member',
			'Guitar',
			'inviter-1'
		);

		expect(result.type).toBe('existing_user');
		expect(result.id).toBe('member-1');
		expect(mockInvite).toHaveBeenCalledWith(
			'band-1',
			'user-existing',
			'member',
			'Guitar',
			'inviter-1'
		);
	});

	it('creates a group invite when the address has no account', async () => {
		// select 1: user lookup — not found. There is no second select: re-inviting
		// is an upsert onto the partial unique index now, not a SELECT for an
		// existing pending row followed by an INSERT.
		selectResults.push([]);

		const result = await createInvite('new@test.com', 'band-1', 'member', 'Drums', 'inviter-1');

		expect(result.type).toBe('group_invite');
		expect(result.id).toBe('inv-new');
		expect(insertResult).toHaveLength(1);
		expect(insertResult[0]).toMatchObject({
			email: 'new@test.com',
			groupId: 'band-1',
			role: 'member',
			position: 'Drums',
			invitedById: 'inviter-1',
			status: 'pending'
		});
	});

	it('normalizes email to lowercase', async () => {
		selectResults.push([]);

		await createInvite('  USER@Example.COM  ', 'band-1', 'member', null, 'inviter-1');

		expect(insertResult[0]).toMatchObject({ email: 'user@example.com' });
	});

	it('emits group_invite.created with the kind the email has to name', async () => {
		selectResults.push([]);
		// After insert, the fire-and-forget block does 2 more selects:
		// select 2: group name and kind
		selectResults.push([{ name: 'Real Book Club', kind: 'club' }]);
		// select 3: inviter name
		selectResults.push([{ name: 'Alice' }]);

		await createInvite('new@test.com', 'group-1', 'member', null, 'inviter-1');

		// Event is fire-and-forget (Promise.resolve().then), flush microtasks
		await new Promise((r) => setTimeout(r, 0));

		expect(mockEmit).toHaveBeenCalledWith(
			'group_invite.created',
			expect.objectContaining({
				email: 'new@test.com',
				groupName: 'Real Book Club',
				// The invitee has no account and no page open, so "join a band" is
				// the one thing the email must not say about a club.
				groupKind: 'club',
				invitedByName: 'Alice',
				role: 'member'
			})
		);
	});
});

describe('resolvePendingInvites', () => {
	it('returns 0 when no pending invites exist', async () => {
		selectResults.push([]); // pending invites query

		const result = await resolvePendingInvites('user-1', 'alice@test.com');

		expect(result).toBe(0);
	});

	it('creates roster rows and marks invites accepted', async () => {
		// pending invites query
		selectResults.push([
			{
				id: 'inv-1',
				groupId: 'band-1',
				role: 'member',
				position: 'Guitar',
				invitedById: 'inviter-1'
			},
			{ id: 'inv-2', groupId: 'band-2', role: 'admin', position: null, invitedById: 'inviter-2' }
		]);

		const result = await resolvePendingInvites('user-1', 'ALICE@Test.com');

		expect(result).toBe(2);
		// 2 inserts (groupMember rows) + we can't easily assert update calls
		// but the function should have created 2 members
		expect(insertResult).toHaveLength(2);
		expect(insertResult[0]).toMatchObject({
			groupId: 'band-1',
			userId: 'user-1',
			role: 'member',
			position: 'Guitar',
			status: 'active'
		});
		expect(insertResult[1]).toMatchObject({
			groupId: 'band-2',
			userId: 'user-1',
			role: 'admin',
			status: 'active'
		});
	});

	it('handles UNIQUE constraint (already on the roster) gracefully', async () => {
		selectResults.push([
			{ id: 'inv-1', groupId: 'band-1', role: 'member', position: null, invitedById: 'inviter-1' }
		]);

		// Override insert to throw UNIQUE error
		const dbMod = await import('$lib/server/db');
		const origInsert = (dbMod.db as any).insert;
		(dbMod.db as any).insert = () => ({
			values: () => {
				throw new Error('UNIQUE constraint failed');
			}
		});

		const result = await resolvePendingInvites('user-1', 'alice@test.com');

		expect(result).toBe(1); // still counted as resolved
		expect(updateCalled).toBe(true); // invite marked accepted

		(dbMod.db as any).insert = origInsert;
	});

	it('continues resolving if one invite fails with non-UNIQUE error', async () => {
		selectResults.push([
			{
				id: 'inv-fail',
				groupId: 'band-1',
				role: 'member',
				position: null,
				invitedById: 'inviter-1'
			},
			{ id: 'inv-ok', groupId: 'band-2', role: 'member', position: null, invitedById: 'inviter-2' }
		]);

		const dbMod = await import('$lib/server/db');
		const origInsert = (dbMod.db as any).insert;
		let insertCount = 0;
		(dbMod.db as any).insert = () => ({
			values: (row: unknown) => {
				insertCount++;
				if (insertCount === 1) throw new Error('Some other DB error');
				insertResult.push(row);
				return { returning: () => Promise.resolve([row]) };
			}
		});

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await resolvePendingInvites('user-1', 'alice@test.com');

		expect(result).toBe(1); // only the second succeeded
		expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));

		consoleSpy.mockRestore();
		(dbMod.db as any).insert = origInsert;
	});
});

describe('revoke', () => {
	it('revokes a pending invite', async () => {
		selectResults.push([{ status: 'pending' }]);

		await revoke('inv-1');

		expect(updateCalled).toBe(true);
	});

	it('throws when invite not found', async () => {
		selectResults.push([]);

		await expect(revoke('nonexistent')).rejects.toThrow(GroupInviteNotFoundError);
	});

	it('throws when invite is not pending', async () => {
		selectResults.push([{ status: 'accepted' }]);

		await expect(revoke('inv-1')).rejects.toThrow(GroupInviteNotPendingError);
	});
});

describe('getByToken', () => {
	it('returns invite metadata for valid token', async () => {
		const futureDate = new Date(Date.now() + 86400000);
		selectResults.push([
			{
				email: 'alice@test.com',
				role: 'member',
				status: 'pending',
				expiresAt: futureDate,
				groupName: 'The Strokes',
				inviterName: 'Bob'
			}
		]);

		const result = await getByToken('tok-abc');

		expect(result).toEqual({
			groupName: 'The Strokes',
			inviterName: 'Bob',
			role: 'member',
			email: 'alice@test.com'
		});
	});

	it('returns null when token not found', async () => {
		selectResults.push([]);

		const result = await getByToken('nonexistent');

		expect(result).toBeNull();
	});

	it('returns null for expired invite', async () => {
		const pastDate = new Date(Date.now() - 86400000);
		selectResults.push([
			{
				email: 'alice@test.com',
				role: 'member',
				status: 'pending',
				expiresAt: pastDate,
				groupName: 'The Strokes',
				inviterName: 'Bob'
			}
		]);

		const result = await getByToken('tok-expired');

		expect(result).toBeNull();
	});

	it('returns null for non-pending invite', async () => {
		const futureDate = new Date(Date.now() + 86400000);
		selectResults.push([
			{
				email: 'alice@test.com',
				role: 'member',
				status: 'revoked',
				expiresAt: futureDate,
				groupName: 'The Strokes',
				inviterName: 'Bob'
			}
		]);

		const result = await getByToken('tok-revoked');

		expect(result).toBeNull();
	});

	it('returns "Someone" when inviter not found', async () => {
		const futureDate = new Date(Date.now() + 86400000);
		selectResults.push([
			{
				email: 'alice@test.com',
				role: 'member',
				status: 'pending',
				expiresAt: futureDate,
				groupName: 'The Strokes',
				inviterName: null
			}
		]);

		const result = await getByToken('tok-abc');

		expect(result!.inviterName).toBe('Someone');
	});
});

describe('listForGroup', () => {
	it('returns invites for the group', async () => {
		const invites = [
			{
				id: 'inv-1',
				email: 'a@test.com',
				role: 'member',
				position: null,
				status: 'pending',
				expiresAt: new Date(),
				createdAt: new Date(),
				invitedByName: 'Alice'
			},
			{
				id: 'inv-2',
				email: 'b@test.com',
				role: 'admin',
				position: 'Bass',
				status: 'accepted',
				expiresAt: new Date(),
				createdAt: new Date(),
				invitedByName: 'Bob'
			}
		];
		selectResults.push(invites);

		const result = await listForGroup('band-1');

		expect(result).toHaveLength(2);
		expect(result[0].email).toBe('a@test.com');
		expect(result[1].position).toBe('Bass');
	});
});
