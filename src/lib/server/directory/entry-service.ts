import { db } from '$lib/server/db';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { group } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { and, desc, eq, isNull, like } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { groupMember, groupSlugHistory } from '$lib/server/db/schema/group';
import { bandSiteInsert } from '$lib/server/band/band-site-service';
import { ensureUniqueSlug, generateSlug } from '$lib/server/utils/slug';
import { isReservedSlug } from '$lib/reserved-slugs';
import { sanitizeBio } from '$lib/utils/markdown';
import { DomainError } from '$lib/server/domain-error';
import { SEARCH_LIMIT } from '$lib/config';
import type { ProfileLink } from '$lib/server/db/schema/authentication';

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
 * Give a user a listing if they have none, and return its id.
 *
 * Called from better-auth's `user.create.after` hook so a new account is in the
 * directory from its first request, and again from the profile save path, which
 * is what repairs an account whose hook failed. The member directory anchors on
 * `directory_entry`, so a user without one is simply not in it.
 *
 * `name` is a copy of `user.name` — better-auth owns that column — kept current
 * by `updateProfile` and the staff `updateUser` form.
 */
export async function ensureUserEntry(userId: string, name: string): Promise<string> {
	const [existing] = await db
		.select({ id: directoryEntry.id })
		.from(directoryEntry)
		.where(eq(directoryEntry.userId, userId))
		.limit(1);
	if (existing) return existing.id;

	const [created] = await db
		.insert(directoryEntry)
		// 'members' rather than the column default of 'public': a new account has
		// not chosen anything yet, and the old `user.directoryVisibility` default
		// this replaces was 'members'. Defaulting a brand-new member to the public
		// web would be a change of policy smuggled in as a migration.
		.values({ userId, name, visibility: 'members' })
		.returning({ id: directoryEntry.id });
	return created.id;
}

/** The entry id for a user, creating one from `user.name` if they somehow have none. */
export async function getOrCreateUserEntryId(userId: string): Promise<string> {
	const [existing] = await db
		.select({ id: directoryEntry.id })
		.from(directoryEntry)
		.where(eq(directoryEntry.userId, userId))
		.limit(1);
	if (existing) return existing.id;

	const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
	if (!row) throw new Error(`No user ${userId} to create a directory entry for`);

	return ensureUserEntry(userId, row.name);
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

// ---------------------------------------------------------------------------
// External acts
// ---------------------------------------------------------------------------

/**
 * An act CMC has booked but which is not a member of anything here.
 *
 * It is a `directory_entry` with **both** `userId` and `groupId` null, and that
 * is the whole of its representation — no `group` row, no slug, no page. Three
 * needs justify keeping a record at all, and they are why lineup rows cannot
 * serve: marketing material for when the act comes back, a contact record for
 * later reference, and a promotion path when somebody from the act joins.
 * `event_band` rows are keyed to an event, so anything stored there is a fact
 * about one night rather than a reusable record of a party.
 */
export class ExternalActNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('External act not found');
		this.name = 'ExternalActNotFoundError';
	}
}

/** The entry already belongs to a member or a band, so there is nothing to claim. */
export class ActAlreadyClaimedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('That act has already been claimed.');
		this.name = 'ActAlreadyClaimedError';
	}
}

export interface CreateExternalActData {
	name: string;
	bio?: string | null;
	hometown?: string | null;
	links?: ProfileLink[] | null;
}

/**
 * Stub an act when staff book it.
 *
 * **Forced to `hidden`, and the caller does not get a say.** An external act is
 * a staff-facing record and nothing else: no public profile, no share link, no
 * page rendered to the world at any URL. That is the point of directory
 * visibility being a member benefit, taken to its conclusion — CMC does not host
 * a page for a band that has no relationship with CMC, and the act already has a
 * presence it chose. Taking visibility as a parameter would make "hidden" a
 * default somebody could pass around.
 */
export async function createExternalAct(data: CreateExternalActData): Promise<string> {
	const [row] = await db
		.insert(directoryEntry)
		.values({
			// Both null: that pair *is* what makes this an external act.
			userId: null,
			groupId: null,
			name: data.name.trim(),
			bio: data.bio ? sanitizeBio(data.bio) : null,
			hometown: data.hometown || null,
			links: data.links ?? null,
			visibility: 'hidden'
		})
		.returning({ id: directoryEntry.id });

	return row.id;
}

/** Everything staff can book — unowned entries, newest first. */
export async function listExternalActs(search?: string) {
	const conditions = [isNull(directoryEntry.userId), isNull(directoryEntry.groupId)];
	if (search?.trim()) {
		conditions.push(like(directoryEntry.name, `%${search.trim()}%`));
	}

	return db
		.select({
			id: directoryEntry.id,
			name: directoryEntry.name,
			hometown: directoryEntry.hometown,
			links: directoryEntry.links,
			createdAt: directoryEntry.createdAt
		})
		.from(directoryEntry)
		.where(and(...conditions))
		.orderBy(desc(directoryEntry.createdAt))
		.limit(SEARCH_LIMIT);
}

/**
 * Somebody from the act joined CMC and is claiming it.
 *
 * **One column changes on the entry: `groupId`.** That is the whole benefit of
 * splitting the old `band` table by purpose — under the earlier `band_profile`
 * design this step had to move name, description and avatar between tables and
 * null the originals. Here nothing merges and no rows are reconciled, and the
 * act's entire prior history comes with it for free, because `event_band`
 * pointed at the entry all along rather than at a band that did not exist.
 *
 * The entry keeps its `hidden` visibility. It is now a member band's listing and
 * theirs to publish, but publishing it is their decision to make on their own
 * profile rather than a side effect of claiming.
 *
 * Archiving the act's `contact` row belongs here too and arrives with that table
 * — the booking contact is frequently a manager rather than one of the members
 * who just joined, so it is retired rather than inherited.
 */
export async function claimExternalAct(entryId: string, ownerId: string) {
	const [entry] = await db
		.select({
			id: directoryEntry.id,
			name: directoryEntry.name,
			userId: directoryEntry.userId,
			groupId: directoryEntry.groupId
		})
		.from(directoryEntry)
		.where(eq(directoryEntry.id, entryId))
		.limit(1);

	if (!entry) throw new ExternalActNotFoundError();
	if (entry.userId || entry.groupId) throw new ActAlreadyClaimedError();

	const slug = await ensureUniqueSlug(
		generateSlug(entry.name),
		group,
		group.slug,
		undefined,
		isReservedSlug
	);
	const groupId = crypto.randomUUID();

	await db.batch([
		// Same slug-history retirement `create()` does: a live `group.slug` always
		// shadows a released one, so a stale redirect could only resurface later.
		db.delete(groupSlugHistory).where(eq(groupSlugHistory.slug, slug)),
		db.insert(group).values({ id: groupId, kind: 'band', name: entry.name, slug }),
		db.insert(groupMember).values({
			groupId,
			userId: ownerId,
			role: 'owner',
			status: 'active'
		}),
		// The one column that changes. No entry is created — the act already had
		// one, and that is what carries its history.
		db.update(directoryEntry).set({ groupId }).where(eq(directoryEntry.id, entryId)),
		// The premium microsite record every band has. A claimed act is a band.
		bandSiteInsert(groupId)
	]);

	return { groupId, slug };
}
