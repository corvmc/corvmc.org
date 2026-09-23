import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { db } from './db';
import { scryptHash } from './hash';
import { type SeedRole } from './types';

/**
 * A member staff banned, so the ban record and "Lift ban" render on
 * `/staff/users/seed-banned`. Signing in as `banned@` with `password` fails,
 * which is the point. Kept out of `allUsers` like the other personas; member
 * number 87 is from the free 80–89 block.
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

	return { users: 1 };
}
