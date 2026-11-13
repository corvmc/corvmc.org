import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { contentFlag } from '../../src/lib/server/db/schema/flag';
import { accountRemoval, emailBlocklist } from '../../src/lib/server/db/schema/moderation';
import { db } from './db';
import { scryptHash } from './hash';
import { type SeedRole } from './types';

/**
 * A member staff banned, so the ban record, its removal row and "Lift ban"
 * render on `/staff/members/seed-banned`, and the address is on the blocklist.
 * Signing in as `banned@` with `password` fails, which is the point. Kept out
 * of `allUsers` like the other personas; member number 87 is from 80–89.
 */
export async function seedBannedPersona(roles: SeedRole[], bannedBy: { id: string }) {
	console.log('Seeding banned persona...');
	const memberRole = roles.find((r) => r.name === 'member')?.id;
	if (!memberRole) return { users: 0 };

	const day = 86_400_000;
	const bannedAt = new Date(Date.now() - 12 * day);
	const joined = new Date(Date.now() - 300 * day);
	const id = 'seed-banned';

	await db.insert(user).values({
		id,
		name: 'Dex Harlan',
		email: 'banned@corvallismusic.org',
		emailVerified: true,
		memberNumber: 87,
		createdAt: joined,
		updatedAt: bannedAt,
		deletedAt: bannedAt,
		bannedAt,
		bannedById: bannedBy.id,
		banReason:
			'Threatened another member in the lobby after a booking dispute, and again by email the next day.'
	});
	await db.insert(account).values({
		id: `${id}-credential`,
		accountId: id,
		providerId: 'credential',
		userId: id,
		password: await scryptHash('password'),
		createdAt: joined,
		updatedAt: joined
	});
	await db.insert(modelHasRole).values({ roleId: memberRole, userId: id });

	const reason =
		'Threatened another member in the lobby after a booking dispute, and again by email the next day.';
	const [flag] = await db
		.insert(contentFlag)
		.values({
			entityType: 'member_profile',
			entityId: id,
			origin: 'staff_action',
			reportedByUserId: bannedBy.id,
			reason,
			status: 'resolved',
			resolvedByUserId: bannedBy.id,
			resolutionNotes: reason,
			createdAt: bannedAt,
			resolvedAt: bannedAt
		})
		.returning({ id: contentFlag.id });
	const [removal] = await db
		.insert(accountRemoval)
		.values({
			userId: id,
			actorUserId: bannedBy.id,
			kind: 'ban',
			reason,
			flagId: flag.id,
			ledger: { reservationIds: [], doorCodeIds: [], billing: 'none' },
			createdAt: bannedAt
		})
		.returning({ id: accountRemoval.id });
	await db.insert(emailBlocklist).values({
		email: 'banned@corvallismusic.org',
		source: 'ban',
		removalId: removal.id,
		addedByUserId: bannedBy.id,
		refusedCount: 2,
		lastRefusedAt: new Date(Date.now() - 3 * day),
		createdAt: bannedAt
	});

	return { users: 1 };
}
