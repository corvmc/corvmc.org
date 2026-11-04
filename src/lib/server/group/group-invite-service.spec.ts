import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const emitted: [string, Record<string, unknown>][] = [];
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: {
		emit: (name: string, payload: Record<string, unknown>) => {
			emitted.push([name, payload]);
			return Promise.resolve();
		},
		on: vi.fn()
	}
}));

const {
	createInvite,
	resolvePendingInvites,
	listForGroup,
	listInvitesForEmail,
	revoke,
	getByToken,
	GroupInviteNotFoundError,
	GroupInviteNotPendingError
} = await import('./group-invite-service');
const { BandMemberExistsError } = await import('#lib/server/band/band-service.js');
const { INVITE_EXPIRY_DAYS } = await import('#lib/config.js');

const T0 = 1_750_000_000;
const DAY = 86_400;

function member(id: string, email = `${id}@example.com`) {
	sqlite
		.prepare(`insert into user (id, name, email) values (?, ?, ?)`)
		.run(id, `Name ${id}`, email);
}

function band(id: string, opts: { kind?: string; deleted?: boolean } = {}) {
	sqlite
		.prepare(`insert into "group" (id, kind, name, slug, deleted_at) values (?, ?, ?, ?, ?)`)
		.run(id, opts.kind ?? 'band', `Group ${id}`, id, opts.deleted ? T0 : null);
}

function invitation(
	id: string,
	cols: {
		email?: string;
		groupId?: string;
		role?: string;
		position?: string | null;
		invitedById?: string | null;
		status?: string;
		expiresAt?: number;
		createdAt?: number;
	} = {}
) {
	sqlite
		.prepare(
			`insert into group_invite (id, email, token, group_id, role, position, invited_by_id, status, expires_at, created_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			cols.email ?? 'alice@test.com',
			`tok-${id}`,
			cols.groupId ?? 'band-1',
			cols.role ?? 'member',
			cols.position ?? null,
			cols.invitedById === undefined ? 'inviter-1' : cols.invitedById,
			cols.status ?? 'pending',
			cols.expiresAt ?? T0 + DAY,
			cols.createdAt ?? T0
		);
}

const invites = () =>
	sqlite
		.prepare(
			`select id, email, group_id, role, position, status, expires_at, accepted_at from group_invite order by id`
		)
		.all() as Record<string, unknown>[];

const roster = () =>
	sqlite
		.prepare(`select group_id, user_id, role, position, status from group_member order by group_id`)
		.all();

beforeEach(async () => {
	// Drain the previous test's fire-and-forget emits so none lands in this one.
	await new Promise((r) => setTimeout(r, 0));
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(T0 * 1000);
	emitted.length = 0;
	sqlite.exec(`drop trigger if exists temp.group_member_fails`);
	for (const t of ['group_invite', 'group_member', '"group"', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	member('inviter-1');
	band('band-1');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createInvite', () => {
	it('puts an existing account on the roster as pending instead of emailing an invite', async () => {
		member('user-existing', 'alice@example.com');

		const result = await createInvite(
			'Alice@Example.COM',
			'band-1',
			'member',
			'Guitar',
			'inviter-1'
		);

		expect(result).toEqual({ type: 'existing_user', id: expect.any(String) });
		expect(roster()).toEqual([
			{
				group_id: 'band-1',
				user_id: 'user-existing',
				role: 'member',
				position: 'Guitar',
				status: 'pending'
			}
		]);
		expect(invites()).toEqual([]);
	});

	it.each([
		['active', 'That person is already in this band.'],
		['pending', 'That person already has a pending invitation to this band.']
	])('refuses an account already %s on this roster', async (status, message) => {
		member('user-existing', 'alice@example.com');
		sqlite
			.prepare(
				`insert into group_member (id, group_id, user_id, role, status) values ('gm', 'band-1', 'user-existing', 'member', ?)`
			)
			.run(status);

		const err = await createInvite(
			'alice@example.com',
			'band-1',
			'member',
			null,
			'inviter-1'
		).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(BandMemberExistsError);
		expect((err as Error).message).toBe(message);
	});

	it("is not refused by the account's membership of a different band", async () => {
		member('user-existing', 'alice@example.com');
		band('band-2');
		sqlite.exec(
			`insert into group_member (id, group_id, user_id, role, status) values ('gm', 'band-2', 'user-existing', 'member', 'active')`
		);

		const result = await createInvite('alice@example.com', 'band-1', 'member', null, 'inviter-1');

		expect(result.type).toBe('existing_user');
	});

	it('creates a pending invite, lowercased and trimmed, when the address has no account', async () => {
		const result = await createInvite('  NEW@Test.com  ', 'band-1', 'member', 'Drums', 'inviter-1');

		expect(result).toEqual({ type: 'group_invite', id: expect.any(String) });
		expect(invites()).toEqual([
			{
				id: result.id,
				email: 'new@test.com',
				group_id: 'band-1',
				role: 'member',
				position: 'Drums',
				status: 'pending',
				expires_at: T0 + INVITE_EXPIRY_DAYS * DAY,
				accepted_at: null
			}
		]);
	});

	it('re-inviting refreshes the one pending row rather than adding another', async () => {
		invitation('inv-1', { email: 'new@test.com', expiresAt: T0 - DAY, position: 'Bass' });

		const result = await createInvite('new@test.com', 'band-1', 'admin', 'Keys', 'inviter-1');

		expect(result.id).toBe('inv-1');
		expect(invites()).toEqual([
			expect.objectContaining({
				id: 'inv-1',
				role: 'admin',
				position: 'Keys',
				expires_at: T0 + INVITE_EXPIRY_DAYS * DAY
			})
		]);
	});

	it('returns the token only when the caller sends its own email', async () => {
		const quiet = await createInvite('a@test.com', 'band-1', 'member', null, 'inviter-1', {
			notify: false
		});
		const loud = await createInvite('b@test.com', 'band-1', 'member', null, 'inviter-1');

		expect(quiet.token).toBe(
			(
				sqlite.prepare(`select token from group_invite where id = ?`).get(quiet.id) as {
					token: string;
				}
			).token
		);
		expect(loud).not.toHaveProperty('token');
		await vi.waitFor(() => expect(emitted).toHaveLength(1));
		expect(emitted[0][1]).toMatchObject({ email: 'b@test.com' });
	});

	it('emits group_invite.created with the kind the email has to name', async () => {
		band('club-1', { kind: 'club' });

		await createInvite('new@test.com', 'club-1', 'member', null, 'inviter-1');

		await vi.waitFor(() => expect(emitted).toHaveLength(1));
		expect(emitted[0]).toEqual([
			'group_invite.created',
			expect.objectContaining({
				email: 'new@test.com',
				groupId: 'club-1',
				groupName: 'Group club-1',
				// The invitee has no account, so "join a band" must not be said of a club.
				groupKind: 'club',
				invitedByName: 'Name inviter-1',
				role: 'member'
			})
		]);
	});
});

describe('resolvePendingInvites', () => {
	it('returns 0 when the address has no live invite', async () => {
		invitation('inv-expired', { expiresAt: T0 });
		invitation('inv-revoked', { status: 'revoked' });
		invitation('inv-other', { email: 'bob@test.com' });

		expect(await resolvePendingInvites('user-1', 'alice@test.com')).toBe(0);
		expect(roster()).toEqual([]);
	});

	it('creates active roster rows and marks the invites accepted', async () => {
		band('band-2');
		invitation('inv-1', { groupId: 'band-1', role: 'member', position: 'Guitar' });
		invitation('inv-2', { groupId: 'band-2', role: 'admin' });

		expect(await resolvePendingInvites('user-1', 'ALICE@Test.com')).toBe(2);

		expect(roster()).toEqual([
			{
				group_id: 'band-1',
				user_id: 'user-1',
				role: 'member',
				position: 'Guitar',
				status: 'active'
			},
			{ group_id: 'band-2', user_id: 'user-1', role: 'admin', position: null, status: 'active' }
		]);
		expect(invites().map((i) => [i.id, i.status, i.accepted_at])).toEqual([
			['inv-1', 'accepted', T0],
			['inv-2', 'accepted', T0]
		]);
	});

	it('marks the invite accepted when the member is already on the roster', async () => {
		invitation('inv-1');
		sqlite.exec(
			`insert into group_member (id, group_id, user_id, role, status) values ('gm', 'band-1', 'user-1', 'member', 'active')`
		);

		expect(await resolvePendingInvites('user-1', 'alice@test.com')).toBe(1);
		expect(invites()[0]).toMatchObject({ status: 'accepted' });
		expect(roster()).toHaveLength(1);
	});

	it('keeps resolving past an invite whose roster insert fails for another reason', async () => {
		band('band-2');
		invitation('inv-fail', { groupId: 'band-broken' });
		invitation('inv-ok', { groupId: 'band-2' });
		sqlite.exec(
			`create temp trigger group_member_fails before insert on group_member
			 when new.group_id = 'band-broken' begin select raise(abort, 'disk on fire'); end`
		);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await resolvePendingInvites('user-1', 'alice@test.com')).toBe(1);

		expect(consoleSpy).toHaveBeenCalledWith(
			// By shape: the driver's error may come from another realm.
			expect.objectContaining({ message: 'disk on fire' })
		);
		expect(invites().map((i) => [i.id, i.status])).toEqual([
			['inv-fail', 'pending'],
			['inv-ok', 'accepted']
		]);
		consoleSpy.mockRestore();
	});
});

describe('revoke', () => {
	it('revokes a pending invite', async () => {
		invitation('inv-1');

		await revoke('inv-1');

		expect(invites()[0]).toMatchObject({ status: 'revoked' });
	});

	it('throws when the invite does not exist', async () => {
		await expect(revoke('nonexistent')).rejects.toThrow(GroupInviteNotFoundError);
	});

	it('throws when the invite is not pending', async () => {
		invitation('inv-1', { status: 'accepted' });

		await expect(revoke('inv-1')).rejects.toThrow(GroupInviteNotPendingError);
		expect(invites()[0]).toMatchObject({ status: 'accepted' });
	});

	it("will not revoke another group's invite when scoped to a group", async () => {
		invitation('inv-1', { groupId: 'band-2' });

		await expect(revoke('inv-1', 'band-1')).rejects.toThrow(GroupInviteNotFoundError);
		expect(invites()[0]).toMatchObject({ status: 'pending' });

		await revoke('inv-1', 'band-2');
		expect(invites()[0]).toMatchObject({ status: 'revoked' });
	});
});

describe('getByToken', () => {
	it('returns invite metadata for a live token', async () => {
		invitation('inv-1');

		expect(await getByToken('tok-inv-1')).toEqual({
			groupName: 'Group band-1',
			inviterName: 'Name inviter-1',
			role: 'member',
			email: 'alice@test.com'
		});
	});

	it('returns null for an unknown token', async () => {
		invitation('inv-1');
		expect(await getByToken('nonexistent')).toBeNull();
	});

	it('returns null once the invite has expired', async () => {
		invitation('inv-1', { expiresAt: T0 });
		expect(await getByToken('tok-inv-1')).toBeNull();
	});

	it('returns null for a non-pending invite', async () => {
		invitation('inv-1', { status: 'revoked' });
		expect(await getByToken('tok-inv-1')).toBeNull();
	});

	it('names the inviter "Someone" when their account is gone', async () => {
		invitation('inv-1', { invitedById: null });
		expect((await getByToken('tok-inv-1'))!.inviterName).toBe('Someone');
	});
});

describe('listForGroup', () => {
	it("returns the group's invites of every status, newest first", async () => {
		band('band-2');
		invitation('inv-1', { email: 'a@test.com', createdAt: T0 - DAY });
		invitation('inv-2', {
			email: 'b@test.com',
			role: 'admin',
			position: 'Bass',
			status: 'accepted',
			createdAt: T0
		});
		invitation('inv-3', { email: 'c@test.com', groupId: 'band-2' });

		const result = await listForGroup('band-1');

		expect(result.map((r) => [r.email, r.status, r.position, r.invitedByName])).toEqual([
			['b@test.com', 'accepted', 'Bass', 'Name inviter-1'],
			['a@test.com', 'pending', null, 'Name inviter-1']
		]);
	});
});

/**
 * #906: an emailed invitation reached the member nowhere. `resolvePendingInvites`
 * filters on expiry and only runs at signup; `getByToken` returns null past
 * expiry. This is the read that lets a surface say it happened.
 */
describe('listInvitesForEmail', () => {
	it('returns expired invitations rather than filtering them out', async () => {
		invitation('inv-1', { expiresAt: T0 - 600 * DAY });

		const rows = await listInvitesForEmail('alice@test.com');

		expect(rows.map((r) => [r.id, r.groupName, r.groupKind])).toEqual([
			['inv-1', 'Group band-1', 'band']
		]);
		expect(rows[0].expiresAt).toEqual(new Date((T0 - 600 * DAY) * 1000));
	});

	it('normalises the email the way createInvite stores it', async () => {
		invitation('inv-1');

		expect(await listInvitesForEmail('  Alice@Test.com  ')).toHaveLength(1);
	});

	it('leaves out settled invites, deleted groups and other addresses', async () => {
		band('band-gone', { deleted: true });
		invitation('inv-accepted', { status: 'accepted' });
		invitation('inv-gone', { groupId: 'band-gone' });
		invitation('inv-bob', { email: 'bob@test.com' });

		expect(await listInvitesForEmail('alice@test.com')).toEqual([]);
	});
});
