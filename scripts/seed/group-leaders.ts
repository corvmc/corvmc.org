import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { db } from './db';
import { scryptHash } from './hash';
import { pendingEntries } from './pending';
import { type SeedRole, type SeedUser } from './types';

/**
 * A loginable leader for each join policy, and not one of them staff.
 *
 * Leaders used to come from the 20 bulk users, which get no `account` row —
 * leaving `admin@corvallismusic.org` the only reachable group manager, and
 * staff, so every surface rendered whether the leader path existed or not.
 */
// One per policy: `open` has nothing to approve, `by_application` has a
// request queue, `invite_only` can only grow by invitation.
// Member numbers from the free 73–79 block; 85–86 are the tech-rider pair.
// `user.member_number` is UNIQUE, so a reused one fails the whole seed.
export const GROUP_LEADER_PERSONAS = [
	{
		id: 'seed-group-leader-open',
		email: 'clubhost@corvallismusic.org',
		name: 'Marisol Vance',
		memberNumber: 73,
		joinPolicy: 'open' as const,
		tagline: 'Runs the Real Book Club',
		bio: 'Plays trumpet badly and charts well. Hosts the monthly jam.'
	},
	{
		id: 'seed-group-leader-application',
		email: 'chair@corvallismusic.org',
		name: 'Devin Achebe',
		memberNumber: 74,
		joinPolicy: 'by_application' as const,
		tagline: 'Chairs the Programming Committee',
		bio: 'Books the room and argues about it afterwards.'
	},
	{
		id: 'seed-group-leader-invite',
		email: 'facilities@corvallismusic.org',
		name: 'Rowan Petrakis',
		memberNumber: 75,
		joinPolicy: 'invite_only' as const,
		tagline: 'Chairs the Facilities Committee',
		bio: 'Fixes what breaks. Keeps a list of what is about to.'
	}
];

export type GroupLeaderPersona = (typeof GROUP_LEADER_PERSONAS)[number];

/**
 * Kept out of `allUsers`, like the solo-act and volunteer personas:
 * `seedUserRoles` indexes into that array and `seedVolunteerProfiles` slices
 * it, so appending would silently reassign both.
 *
 * `member` and nothing else — a leader holding a position would pass
 * `isElevated` and read every group surface as staff.
 */
export async function seedGroupLeaders(roles: SeedRole[]): Promise<SeedUser[]> {
	console.log('Seeding group leaders...');
	const memberRole = roles.find((r) => r.name === 'member')?.id;
	if (!memberRole) return [];

	const createdAt = new Date(Date.now() - 300 * 86400000);
	const leaders: SeedUser[] = [];

	for (const p of GROUP_LEADER_PERSONAS) {
		const [row] = await db
			.insert(user)
			.values({
				id: p.id,
				name: p.name,
				email: p.email,
				emailVerified: true,
				memberNumber: p.memberNumber,
				creditFreeHours: 2,
				createdAt,
				updatedAt: createdAt
			})
			.returning();
		await db.insert(account).values({
			id: `${p.id}-credential`,
			accountId: p.id,
			providerId: 'credential',
			userId: p.id,
			password: await scryptHash('password'),
			createdAt,
			updatedAt: createdAt
		});
		await db.insert(modelHasRole).values({ roleId: memberRole, userId: p.id });

		// A listing each, so a leader appears in the member directory like anyone
		// else — the roster links to it, and a leader with no entry would make the
		// roster's own links look broken.
		pendingEntries.set(p.id, {
			bio: p.bio,
			tagline: p.tagline,
			hometown: 'Corvallis, OR',
			visibility: 'members',
			openToCollaboration: true
		});

		leaders.push({ ...row, email: p.email });
	}

	return leaders;
}

/** Where to sign in to read the leader-only group surfaces. */
export const GROUP_LEADER_LOGINS = GROUP_LEADER_PERSONAS.map((p) => ({
	email: p.email,
	joinPolicy: p.joinPolicy
}));
