/**
 * Give every seeded user and group a `directory_entry`, exactly as
 * `scripts/db/backfill/directory-entry.sql` does for production.
 *
 * Runs LAST, after every other fixture, and sweeps rather than being threaded
 * through the eight fixtures that insert a user. That is deliberate: the
 * directory reads `directory_entry`, so a subject without one is missing from
 * it — and the existing directory specs key off tab controls and URLs rather
 * than card counts, so an empty directory passes almost all of them. Requiring
 * the next fixture author to remember a second insert is how that regression
 * comes back.
 *
 * Idempotent, like the SQL it mirrors: it only inserts what is missing.
 */
import 'dotenv/config';
import { notInArray, sql } from 'drizzle-orm';
import { user } from '../../src/lib/server/db/schema/authentication';
import { group } from '../../src/lib/server/db/schema/group';
import { directoryEntry } from '../../src/lib/server/db/schema/directory';
import { bandSite } from '../../src/lib/server/db/schema/band-site';
import { withPlatformEnv } from './platform-db';

export async function seedDirectoryEntries(): Promise<void> {
	await withPlatformEnv(async ({ db }) => {
		const claimed = await db
			.select({ userId: directoryEntry.userId, groupId: directoryEntry.groupId })
			.from(directoryEntry);

		const claimedUsers = claimed.map((r) => r.userId).filter((id): id is string => !!id);
		const claimedGroups = claimed.map((r) => r.groupId).filter((id): id is string => !!id);

		const users = await db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(claimedUsers.length ? notInArray(user.id, claimedUsers) : sql`1 = 1`);

		const groups = await db
			.select({ id: group.id, name: group.name, bio: group.bio, deletedAt: group.deletedAt })
			.from(group)
			.where(claimedGroups.length ? notInArray(group.id, claimedGroups) : sql`1 = 1`);

		const rows = [
			// 'members' matches the default `ensureUserEntry` uses at signup. A
			// fixture that needs a public member sets its own entry.
			...users.map((u) => ({ userId: u.id, name: u.name, visibility: 'members' as const })),
			// `deletedAt` is carried: a deactivated band whose entry stayed live
			// would be back in the public directory.
			...groups.map((g) => ({
				groupId: g.id,
				name: g.name,
				bio: g.bio,
				visibility: 'public' as const,
				deletedAt: g.deletedAt
			}))
		];

		// 5 rows × the widest shape stays under D1's 100 bound parameters.
		for (let i = 0; i < rows.length; i += 5) {
			await db.insert(directoryEntry).values(rows.slice(i, i + 5));
		}

		// Every band needs a `band_site` too — `tier` lives there since phase 3b,
		// and a band without one reads as free. Swept here for the same reason the
		// entries are: the fixtures that create groups should not each have to
		// learn about it.
		const sited = (await db.select({ groupId: bandSite.groupId }).from(bandSite)).map(
			(r) => r.groupId
		);
		const unsited = await db
			.select({ id: group.id, tier: group.tier, createdAt: group.createdAt })
			.from(group)
			.where(sited.length ? notInArray(group.id, sited) : sql`1 = 1`);

		if (unsited.length) {
			await db.insert(bandSite).values(
				unsited.map((g) => ({
					groupId: g.id,
					tier: g.tier,
					createdAt: g.createdAt,
					updatedAt: g.createdAt
				}))
			);
		}

		// A member fixture that wants to be publicly browsable says so on the user
		// row it already writes; carry that across rather than making each fixture
		// learn about entries.
		await db.run(sql`
			UPDATE directory_entry
			   SET visibility = (SELECT directory_visibility FROM "user" WHERE "user".id = directory_entry.user_id)
			 WHERE user_id IS NOT NULL
		`);
	});
}
