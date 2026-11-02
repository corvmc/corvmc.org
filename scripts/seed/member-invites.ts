import { memberInvite } from '../../src/lib/server/db/schema/member-invite';
import { batchInsert } from './db';

/**
 * Invitations to join CMC, one per state the staff list draws: pending from
 * staff and from a member, expired, revoked, and one accepted by `joined`,
 * whose address it carries.
 */
export async function seedMemberInvites(
	staff: { id: string },
	member: { id: string },
	joined: { id: string; email: string }
) {
	const day = 24 * 3600_000;
	const at = (d: number) => new Date(Date.now() + d * day);
	const rows = await batchInsert(memberInvite, [
		{
			email: 'river.okafor@example.com',
			name: 'River Okafor',
			invitedById: staff.id,
			sentAt: at(-1),
			expiresAt: at(6)
		},
		{
			email: 'jo.bassline@example.com',
			invitedById: member.id,
			sentAt: at(-2),
			expiresAt: at(5)
		},
		{
			email: 'lapsed.drummer@example.com',
			name: 'Pat Lapsed',
			invitedById: member.id,
			sentAt: at(-20),
			expiresAt: at(-13)
		},
		{
			email: 'wrong.address@example.com',
			invitedById: staff.id,
			status: 'revoked',
			sentAt: at(-9),
			expiresAt: at(-2),
			revokedById: staff.id,
			revokedAt: at(-8)
		},
		{
			email: joined.email,
			invitedById: member.id,
			status: 'accepted',
			sentAt: at(-30),
			expiresAt: at(-23),
			acceptedById: joined.id,
			acceptedAt: at(-29)
		}
	]);
	return { invites: rows.length };
}
