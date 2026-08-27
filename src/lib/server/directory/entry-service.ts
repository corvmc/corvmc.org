import { db } from '$lib/server/db';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { group } from '$lib/server/db/schema/group';
import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

/**
 * The `directory_entry` a subject owns — created with it, and the one row every
 * listing read and write goes through.
 *
 * Kept out of `profile-service.ts` because it is not about profiles: band
 * creation, band deactivation and (in phase 10) claiming an external act all
 * need an entry and none of them are editing one.
 */

/** The insert a `group`'s entry is created from, for the batch that creates the group. */
export function groupEntryInsert(values: {
	groupId: string;
	name: string;
	bio?: string | null;
	avatarKey?: string | null;
}) {
	return db.insert(directoryEntry).values({
		groupId: values.groupId,
		// A copy, deliberately — see the column comment. `group.name` stays
		// canonical, so a rename has to write both.
		name: values.name,
		bio: values.bio ?? null,
		avatarKey: values.avatarKey ?? null
	});
}

/**
 * The entry id for a group, creating one if it somehow has none.
 *
 * Every existing group got an entry from
 * `scripts/db/backfill/directory-entry.sql` and every new one gets it in the
 * same batch as the group row, so the create branch should be dead. It is here
 * because the alternative when it is not dead is worse: an `UPDATE … WHERE
 * entry_id = null` silently writes nothing, and the member would be told their
 * profile saved. A band created in the window between the backfill running and
 * this code deploying is the one real way to reach it.
 */
export async function getOrCreateGroupEntryId(groupId: string): Promise<string> {
	const [existing] = await db
		.select({ id: directoryEntry.id })
		.from(directoryEntry)
		.where(eq(directoryEntry.groupId, groupId))
		.limit(1);
	if (existing) return existing.id;

	const [row] = await db
		.select({ name: group.name, bio: group.bio, avatarKey: group.avatarKey })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	if (!row) throw new Error(`No group ${groupId} to create a directory entry for`);

	const [created] = await db
		.insert(directoryEntry)
		.values({ groupId, name: row.name, bio: row.bio, avatarKey: row.avatarKey })
		.returning({ id: directoryEntry.id });
	return created.id;
}

/**
 * Replace one kind of tag on an entry, as batch statements.
 *
 * Delete-then-insert scoped to `kind`, which is the part that has to be right:
 * genres and instruments share a table now, so an unscoped delete would clear a
 * member's instruments every time they saved their genres.
 */
export function replaceTags(
	entryId: string,
	kind: 'genre' | 'instrument',
	values: string[]
): BatchItem<'sqlite'>[] {
	const statements: BatchItem<'sqlite'>[] = [
		db
			.delete(directoryTag)
			.where(and(eq(directoryTag.entryId, entryId), eq(directoryTag.kind, kind)))
	];
	if (values.length > 0) {
		statements.push(
			db.insert(directoryTag).values(values.map((value) => ({ entryId, kind, value })))
		);
	}
	return statements;
}
