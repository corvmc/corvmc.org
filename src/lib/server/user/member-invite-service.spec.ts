import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Against a real SQLite: "has an account" and "is an open group" are WHERE clauses. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});
vi.mock('$lib/server/db', () => ({ db: testDb }));

const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...a) }
}));

const { inviteMember, MemberInviteGroupError } = await import('./member-invite-service');
const { resolvePendingInvites } = await import('$lib/server/group/group-invite-service');

const STAFF = { id: 'usr-staff', name: 'Sam Staff' };

/** Every event emitted, after letting any fire-and-forget emit run. */
async function emitted() {
	await new Promise((r) => setTimeout(r, 0));
	return emit.mock.calls.map((c) => ({ name: c[0], data: c[1] as Record<string, unknown> }));
}

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec(`
		delete from group_member; delete from group_invite; delete from "group"; delete from user;
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
