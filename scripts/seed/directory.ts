import { type DirectoryVisibility, user } from '../../src/lib/server/db/schema/authentication';
import { directoryEntry, directoryTag } from '../../src/lib/server/db/schema/directory';
import { group } from '../../src/lib/server/db/schema/group';
import { batchInsert, db } from './db';
import { pendingEntries, pendingTags } from './pending';
import { randomUUID } from 'crypto';

export async function seedDirectoryEntries() {
	console.log('Seeding directory entries...');

	// Identity and timestamps still come off the subject; everything the listing
	// owns comes from `pendingEntries`, because phase 3c drops those columns.
	const users = await db
		.select({
			id: user.id,
			name: user.name,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			deletedAt: user.deletedAt
		})
		.from(user);

	const groups = await db
		.select({
			id: group.id,
			name: group.name,
			bio: group.bio,
			avatarKey: group.avatarKey,
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
			deletedAt: group.deletedAt
		})
		.from(group);

	// `deletedAt` is carried, not reset: an entry that did not follow its
	// deactivated band would put that band back in the public directory.
	const entries = [
		...groups.map((g) => {
			const p = pendingEntries.get(g.id) ?? {};
			return {
				id: randomUUID(),
				groupId: g.id,
				name: g.name,
				// `bio` is a copy that stays canonical on `group`, so it still
				// comes from there. Everything else below moved.
				bio: g.bio,
				tagline: p.tagline ?? null,
				hometown: p.hometown ?? null,
				foundedYear: p.foundedYear ?? null,
				avatarKey: g.avatarKey,
				links: p.links ?? null,
				visibility: p.visibility ?? ('public' as DirectoryVisibility),
				contact: p.contact ?? null,
				lookingFor: p.lookingFor ?? null,
				createdAt: g.createdAt,
				updatedAt: g.updatedAt,
				deletedAt: g.deletedAt
			};
		}),
		// `avatarKey` is deliberately null for a member: their avatar stays
		// `user.image`, which may hold a full OAuth URL rather than an R2 key.
		...users.map((u) => {
			const p = pendingEntries.get(u.id) ?? {};
			return {
				id: randomUUID(),
				userId: u.id,
				name: u.name,
				bio: p.bio ?? null,
				tagline: p.tagline ?? null,
				hometown: p.hometown ?? null,
				links: p.links ?? null,
				visibility: p.visibility ?? ('members' as DirectoryVisibility),
				contact: p.contact ?? null,
				lookingFor: p.lookingFor ?? null,
				availableForHire: p.availableForHire ?? false,
				teachesLessons: p.teachesLessons ?? false,
				openToCollaboration: p.openToCollaboration ?? false,
				createdAt: u.createdAt,
				updatedAt: u.updatedAt,
				deletedAt: u.deletedAt
			};
		})
	];

	// 19 columns × the default batch of 10 is 190 bound parameters, over D1's
	// 100-variable ceiling. 5 × 19 = 95.
	await batchInsert(directoryEntry, entries, 5);

	const byGroup = new Map(entries.filter((e) => 'groupId' in e).map((e: any) => [e.groupId, e.id]));
	const byUser = new Map(entries.filter((e) => 'userId' in e).map((e: any) => [e.userId, e.id]));

	// Deduped through a Set the way the backfill's ON CONFLICT DO NOTHING does:
	// `directory_tag` has a unique index that the three tables it replaced never
	// had, so a subject picked the same genre twice would abort the insert.
	const seen = new Set<string>();
	const tags: { entryId: string; kind: 'genre' | 'instrument'; value: string }[] = [];
	for (const { subjectId, kind, value } of pendingTags) {
		const entryId = byUser.get(subjectId) ?? byGroup.get(subjectId);
		if (!entryId) continue;
		const key = `${entryId}:${kind}:${value}`;
		if (seen.has(key)) continue;
		seen.add(key);
		tags.push({ entryId, kind, value });
	}

	// 3 columns × 30 = 90.
	await batchInsert(directoryTag, tags, 30);

	return { entries: entries.length, tags: tags.length };
}
