import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Against a real SQLite: "has an account" and "is an open group" are WHERE clauses. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order.
vi.mock('#lib/server/db/index.js', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...a) }
}));

const {
	inviteMember,
	resendMemberInvite,
	revokeMemberInvite,
	resolveMemberInvite,
	listMemberInvites,
	MemberInviteGroupError,
	MemberInviteLimitError,
	MemberInviteNotPendingError
} = await import('./member-invite-service');
const { resolvePendingInvites } = await import('#lib/server/group/group-invite-service.js');

const STAFF = { id: 'usr-staff', name: 'Sam Staff' };

/** Every event emitted, after letting any fire-and-forget emit run. */
async function emitted() {
	await new Promise((r) => setTimeout(r, 0));
	return emit.mock.calls.map((c) => ({ name: c[0], data: c[1] as Record<string, unknown> }));
}

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec(`
		delete from member_invite; delete from group_member; delete from group_invite; delete from "group"; delete from user;
		insert into user (id, name, email, email_verified) values
			('usr-staff', 'Sam Staff', 'staff@example.com', 0),
			('usr-mo', 'Mo', 'mo@example.com', 0);
		insert into "group" (id, kind, name, slug, join_policy) values
			('grp-club', 'club', 'Jazz Club', 'jazz-club', 'by_application'),
			('grp-cttee', 'committee', 'Booking', 'booking', 'by_application'),
			('grp-band', 'band', 'A Band', 'a-band', 'invite_only');
	`);
});

describe('inviteMember', () => {
	it('sends no email to an address that already has an account, and names the account', async () => {
		const result = await inviteMember({ email: '  MO@example.com ', invitedBy: STAFF });

		expect(result).toEqual({ kind: 'existing', userId: 'usr-mo', name: 'Mo' });
		expect(await emitted()).toEqual([]);
	});

	it('announces one invitation with no token when no group is chosen', async () => {
		const result = await inviteMember({ email: 'New@Example.com', name: 'Nia', invitedBy: STAFF });

		expect(result).toEqual({ kind: 'invited', email: 'new@example.com' });
		expect(await emitted()).toEqual([
			{
				name: 'member_invite.created',
				data: {
					email: 'new@example.com',
					name: 'Nia',
					invitedByName: 'Sam Staff',
					groups: [],
					token: null
				}
			}
		]);
	});

	it('records a group invite per chosen group, sends one email, and seats them on sign-up', async () => {
		await inviteMember({
			email: 'new@example.com',
			groupIds: ['grp-club', 'grp-cttee'],
			invitedBy: STAFF
		});

		const invites = sqlite
			.prepare(`select group_id, token from group_invite where email = 'new@example.com'`)
			.all() as { group_id: string; token: string }[];
		expect(invites.map((i) => i.group_id).sort()).toEqual(['grp-club', 'grp-cttee']);
		// One email, not one per group: the group invites' own email is suppressed.
		const events = await emitted();
		expect(events.map((e) => e.name)).toEqual(['member_invite.created']);
		expect(invites.map((i) => i.token)).toContain(events[0].data.token);
		expect(events[0].data.groups).toHaveLength(2);

		sqlite.exec(
			`insert into user (id, name, email, email_verified) values ('usr-new', 'Nia', 'new@example.com', 0)`
		);
		expect(await resolvePendingInvites('usr-new', 'new@example.com')).toBe(2);
	});

	it('refuses a band, which is its own admins’ to invite to', async () => {
		await expect(
			inviteMember({ email: 'new@example.com', groupIds: ['grp-band'], invitedBy: STAFF })
		).rejects.toBeInstanceOf(MemberInviteGroupError);
		expect(await emitted()).toEqual([]);
	});
});

const MEMBER = { id: 'usr-mo', name: 'Mo' };

function inviteRow(email: string) {
	return sqlite
		.prepare(`select * from member_invite where email = ? order by sent_at desc limit 1`)
		.get(email) as Record<string, unknown> | undefined;
}

describe('the member invite record', () => {
	it('records a pending invite, and a repeat while it is live sends nothing', async () => {
		await inviteMember({ email: 'new@example.com', name: 'Nia', invitedBy: STAFF });
		expect(inviteRow('new@example.com')).toMatchObject({
			status: 'pending',
			name: 'Nia',
			invited_by_id: 'usr-staff'
		});
		emit.mockClear();

		const again = await inviteMember({ email: 'new@example.com', invitedBy: MEMBER });
		expect(again).toEqual({ kind: 'pending', email: 'new@example.com' });
		expect(await emitted()).toEqual([]);
	});

	it('refreshes an expired pending invite in place and sends it again', async () => {
		await inviteMember({ email: 'new@example.com', invitedBy: STAFF });
		sqlite.exec(`update member_invite set expires_at = 1`);
		emit.mockClear();

		const again = await inviteMember({ email: 'new@example.com', invitedBy: MEMBER });
		expect(again.kind).toBe('invited');
		const rows = sqlite.prepare(`select * from member_invite`).all() as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0].invited_by_id).toBe('usr-mo');
		expect(rows[0].expires_at as number).toBeGreaterThan(Date.now() / 1000);
		expect((await emitted()).map((e) => e.name)).toEqual(['member_invite.created']);
	});

	it('holds a limited inviter to five sends a day, and staff to none', async () => {
		for (let i = 0; i < 5; i++) {
			await inviteMember({ email: `f${i}@example.com`, invitedBy: MEMBER, limited: true });
		}
		emit.mockClear();
		await expect(
			inviteMember({ email: 'f5@example.com', invitedBy: MEMBER, limited: true })
		).rejects.toBeInstanceOf(MemberInviteLimitError);
		expect(await emitted()).toEqual([]);
		expect(inviteRow('f5@example.com')).toBeUndefined();

		// A send older than a day no longer counts.
		sqlite.exec(
			`update member_invite set sent_at = unixepoch() - 90000 where email = 'f0@example.com'`
		);
		await expect(
			inviteMember({ email: 'f5@example.com', invitedBy: MEMBER, limited: true })
		).resolves.toMatchObject({ kind: 'invited' });

		for (let i = 0; i < 6; i++) {
			await inviteMember({ email: `s${i}@example.com`, invitedBy: STAFF });
		}
		expect(inviteRow('s5@example.com')).toBeDefined();
	});

	it('revoking it revokes its group invites, so sign-up seats them nowhere', async () => {
		await inviteMember({ email: 'new@example.com', groupIds: ['grp-club'], invitedBy: STAFF });
		const { id } = inviteRow('new@example.com') as { id: string };

		await revokeMemberInvite(id, 'usr-staff');
		expect(inviteRow('new@example.com')).toMatchObject({
			status: 'revoked',
			revoked_by_id: 'usr-staff'
		});
		sqlite.exec(
			`insert into user (id, name, email, email_verified) values ('usr-new', 'Nia', 'new@example.com', 0)`
		);
		expect(await resolvePendingInvites('usr-new', 'new@example.com')).toBe(0);
		await expect(revokeMemberInvite(id, 'usr-staff')).rejects.toBeInstanceOf(
			MemberInviteNotPendingError
		);
	});

	it('resending extends the expiry and sends the email with the group token', async () => {
		await inviteMember({ email: 'new@example.com', groupIds: ['grp-club'], invitedBy: STAFF });
		sqlite.exec(`update member_invite set expires_at = 1; update group_invite set expires_at = 1`);
		const { id } = inviteRow('new@example.com') as { id: string };
		emit.mockClear();

		await resendMemberInvite(id, STAFF);
		expect(inviteRow('new@example.com')!.expires_at as number).toBeGreaterThan(Date.now() / 1000);
		const [g] = sqlite.prepare(`select token, expires_at from group_invite`).all() as {
			token: string;
			expires_at: number;
		}[];
		expect(g.expires_at).toBeGreaterThan(Date.now() / 1000);
		const events = await emitted();
		expect(events).toHaveLength(1);
		expect(events[0].data.token).toBe(g.token);
	});

	it('is accepted by the account that signs up with that address', async () => {
		await inviteMember({ email: 'new@example.com', invitedBy: STAFF });
		await resolveMemberInvite('usr-new', 'New@Example.com');
		expect(inviteRow('new@example.com')).toMatchObject({
			status: 'accepted',
			accepted_by_id: 'usr-new'
		});
	});

	it('lists invites by status, flagging the expired ones', async () => {
		await inviteMember({ email: 'a@example.com', groupIds: ['grp-club'], invitedBy: STAFF });
		await inviteMember({ email: 'b@example.com', invitedBy: MEMBER });
		sqlite.exec(`update member_invite set expires_at = 1 where email = 'b@example.com'`);
		await resolveMemberInvite('usr-x', 'a@example.com');

		const pending = await listMemberInvites({ status: 'pending' });
		expect(pending.pagination.total).toBe(1);
		expect(pending.rows[0]).toMatchObject({
			email: 'b@example.com',
			expired: true,
			invitedByName: 'Mo'
		});
		const all = await listMemberInvites({});
		expect(all.rows.find((r) => r.email === 'a@example.com')).toMatchObject({
			status: 'accepted',
			groupCount: 1,
			expired: false
		});
	});
});
