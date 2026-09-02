import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { getOrCreateGroupEntryId, getOrCreateUserEntryId, replaceTags } from './entry-service';
import { groupMember } from '$lib/server/db/schema/group';
import { eq, and } from 'drizzle-orm';
import { uploadFile } from '$lib/server/storage';
import { detachSlot, replaceSlot } from '$lib/server/media/media-service';
import { mediaKey } from '$lib/server/storage-keys';
import { sanitizeBio } from '$lib/utils/markdown';
import type { BatchItem } from 'drizzle-orm/batch';
import type {
	DirectoryContact,
	DirectoryVisibility,
	ProfileLink
} from '$lib/server/db/schema/authentication';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_LINKS = 20;
const MAX_TAGLINE = 150;
const MAX_BIO = 2000;
const MAX_TAGS = 20;

function validateLinks(links: unknown): ProfileLink[] {
	if (!Array.isArray(links)) return [];
	return links.slice(0, MAX_LINKS).map((l) => ({
		label: String(l.label ?? '').slice(0, 100),
		url: String(l.url ?? '').slice(0, 500)
	}));
}

function validateContact(contact: unknown): DirectoryContact | null {
	if (!contact || typeof contact !== 'object') return null;
	const c = contact as Record<string, unknown>;
	const result: DirectoryContact = {};
	if (c.email) result.email = String(c.email).slice(0, 255);
	if (c.phone) result.phone = String(c.phone).slice(0, 30);
	if (c.social) result.social = String(c.social).slice(0, 255);
	if (c.address) result.address = String(c.address).slice(0, 500);
	if (c.visibility) result.visibility = String(c.visibility);
	return Object.keys(result).length > 0 ? result : null;
}

function validateTags(tags: unknown): string[] {
	if (!Array.isArray(tags)) return [];
	return tags
		.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
		.map((t) => t.trim().toLowerCase().slice(0, 50))
		.slice(0, MAX_TAGS);
}

// ---------------------------------------------------------------------------
// Member profile
// ---------------------------------------------------------------------------

export type MemberProfileData = {
	bio?: string;
	tagline?: string;
	hometown?: string;
	instruments?: string[];
	genres?: string[];
	lookingForBand?: boolean;
	availableForHire?: boolean;
	teachesLessons?: boolean;
	openToCollaboration?: boolean;
	directoryVisibility?: DirectoryVisibility;
	directoryContact?: DirectoryContact;
	links?: ProfileLink[];
};

export async function updateMemberProfile(userId: string, data: MemberProfileData) {
	const entryId = await getOrCreateUserEntryId(userId);

	let mergedContact: DirectoryContact | null = null;
	if (data.directoryContact) {
		// Read-modify-write, and it has to read the ENTRY. Reading the old
		// `user.directory_contact` here would merge onto a column nothing writes
		// any more, so every field the member did not resubmit would be dropped.
		const [existing] = await db
			.select({ contact: directoryEntry.contact })
			.from(directoryEntry)
			.where(eq(directoryEntry.id, entryId))
			.limit(1);
		const prev = (existing?.contact as DirectoryContact) ?? {};
		mergedContact = validateContact({ ...prev, ...data.directoryContact });
	}

	const queries: BatchItem<'sqlite'>[] = [
		db
			.update(directoryEntry)
			.set({
				bio: data.bio ? sanitizeBio(data.bio).slice(0, MAX_BIO) || null : null,
				tagline: data.tagline?.slice(0, MAX_TAGLINE) ?? null,
				hometown: data.hometown?.slice(0, MAX_TAGLINE) || null,
				lookingFor: data.lookingForBand ? 'band' : null,
				availableForHire: data.availableForHire ?? false,
				teachesLessons: data.teachesLessons ?? false,
				openToCollaboration: data.openToCollaboration ?? false,
				visibility: (data.directoryVisibility ?? 'members') as DirectoryVisibility,
				contact: mergedContact,
				links: data.links ? validateLinks(data.links) : null,
				updatedAt: new Date()
			})
			.where(eq(directoryEntry.id, entryId))
	];

	// Scoped to one `kind` each. Genres and instruments share a table now, so an
	// unscoped delete would clear a member's instruments every time they saved
	// their genres — and every assertion that "saving genres works" would pass.
	if (data.instruments !== undefined) {
		queries.push(...replaceTags(entryId, 'instrument', validateTags(data.instruments)));
	}

	if (data.genres !== undefined) {
		queries.push(...replaceTags(entryId, 'genre', validateTags(data.genres)));
	}

	await db.batch(queries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/** Load current profile data for the edit form */
export async function getMemberProfileForEdit(userId: string) {
	const [row] = await db
		.select({
			id: directoryEntry.id,
			name: directoryEntry.name,
			bio: directoryEntry.bio,
			tagline: directoryEntry.tagline,
			hometown: directoryEntry.hometown,
			// The member's avatar stays `user.image` — better-auth's column, and it
			// may hold a full OAuth URL rather than an R2 key.
			image: user.image,
			// The member's own address is `/m/{memberNumber}`, and this is the one
			// query behind the page that shows it to them. Their own number, on
			// their own profile — the public DTO still whitelists it out.
			memberNumber: user.memberNumber,
			lookingFor: directoryEntry.lookingFor,
			availableForHire: directoryEntry.availableForHire,
			teachesLessons: directoryEntry.teachesLessons,
			openToCollaboration: directoryEntry.openToCollaboration,
			visibility: directoryEntry.visibility,
			contact: directoryEntry.contact,
			links: directoryEntry.links
		})
		.from(directoryEntry)
		.innerJoin(user, eq(user.id, directoryEntry.userId))
		.where(eq(directoryEntry.userId, userId));

	if (!row) return null;

	const tags = await db
		.select({ kind: directoryTag.kind, value: directoryTag.value })
		.from(directoryTag)
		.where(eq(directoryTag.entryId, row.id));

	// Renamed back to the shape the form and its zod schema already use.
	const { id: _entryId, lookingFor, visibility, contact, ...rest } = row;
	return {
		...rest,
		lookingForBand: lookingFor === 'band',
		directoryVisibility: visibility,
		directoryContact: contact,
		instruments: tags.filter((t) => t.kind === 'instrument').map((t) => t.value),
		genres: tags.filter((t) => t.kind === 'genre').map((t) => t.value)
	};
}

// ---------------------------------------------------------------------------
// Band profile
// ---------------------------------------------------------------------------

export type BandProfileData = {
	tagline?: string;
	hometown?: string;
	foundedYear?: string;
	genres?: string[];
	lookingForMembers?: boolean;
	directoryVisibility?: DirectoryVisibility;
	directoryContact?: DirectoryContact;
	links?: ProfileLink[];
};

async function requireBandAdmin(bandId: string, userId: string) {
	const [membership] = await db
		.select({ role: groupMember.role })
		.from(groupMember)
		.where(
			and(
				eq(groupMember.groupId, bandId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active')
			)
		);

	if (!membership || !['owner', 'admin'].includes(membership.role)) {
		throw new Error('Not authorized to edit this band profile');
	}
}

export async function updateBandProfile(bandId: string, userId: string, data: BandProfileData) {
	await requireBandAdmin(bandId, userId);

	const entryId = await getOrCreateGroupEntryId(bandId);

	let mergedContact: DirectoryContact | null = null;
	if (data.directoryContact) {
		// Read-modify-write, and it has to read the ENTRY. Reading the old
		// `group.directory_contact` here would merge onto a column nothing writes
		// any more, so every field the band did not resubmit would be dropped.
		const [existing] = await db
			.select({ contact: directoryEntry.contact })
			.from(directoryEntry)
			.where(eq(directoryEntry.id, entryId))
			.limit(1);
		const prev = (existing?.contact as DirectoryContact) ?? {};
		mergedContact = validateContact({ ...prev, ...data.directoryContact });
	}

	const queries: BatchItem<'sqlite'>[] = [
		db
			.update(directoryEntry)
			.set({
				tagline: data.tagline?.slice(0, MAX_TAGLINE) ?? null,
				hometown: data.hometown?.slice(0, MAX_TAGLINE) || null,
				foundedYear: data.foundedYear?.slice(0, 16) || null,
				lookingFor: data.lookingForMembers ? 'members' : null,
				visibility: (data.directoryVisibility ?? 'public') as DirectoryVisibility,
				contact: mergedContact,
				links: data.links ? validateLinks(data.links) : null,
				updatedAt: new Date()
			})
			.where(eq(directoryEntry.id, entryId))
	];

	if (data.genres !== undefined) {
		queries.push(...replaceTags(entryId, 'genre', validateTags(data.genres)));
	}

	await db.batch(queries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

// ---------------------------------------------------------------------------
// Member avatar
// ---------------------------------------------------------------------------

/** Upload a user's avatar to storage and persist its key on `user.image`. */
export async function setUserAvatar(userId: string, buffer: ArrayBuffer, contentType: string) {
	const key = mediaKey('users/avatars', userId, contentType);
	await uploadFile(buffer, key, contentType);

	// Releases whatever the slot held and records the new object. No delete: the
	// previous object's fate is the sweep's to decide. The OAuth-URL case that
	// used to need guarding here handles itself — a provider URL was never an R2
	// key, so it never had a `media` row to detach.
	await replaceSlot({
		attachableType: 'user',
		attachableId: userId,
		slot: 'avatar',
		key,
		contentType,
		byteSize: buffer.byteLength,
		uploadedByUserId: userId
	});

	// `user.image` stays as the read path — it is better-auth's column and is
	// read in ~15 places — kept in step by this one writer.
	await db.update(user).set({ image: key, updatedAt: new Date() }).where(eq(user.id, userId));
	return key;
}

/** Remove a user's avatar from storage and clear `user.image`. */
export async function clearUserAvatar(userId: string) {
	await detachSlot('user', userId, 'avatar');

	await db.update(user).set({ image: null, updatedAt: new Date() }).where(eq(user.id, userId));
}

/** Load current band profile data for the edit form */
export async function getBandProfileForEdit(bandId: string) {
	const [row] = await db
		.select({
			id: directoryEntry.id,
			tagline: directoryEntry.tagline,
			hometown: directoryEntry.hometown,
			foundedYear: directoryEntry.foundedYear,
			lookingFor: directoryEntry.lookingFor,
			visibility: directoryEntry.visibility,
			contact: directoryEntry.contact,
			links: directoryEntry.links
		})
		.from(directoryEntry)
		.where(eq(directoryEntry.groupId, bandId));

	if (!row) return null;

	const genres = await db
		.select({ value: directoryTag.value })
		.from(directoryTag)
		.where(and(eq(directoryTag.entryId, row.id), eq(directoryTag.kind, 'genre')));

	// Renamed back to the shape the form and its zod schema already use. Phase 3a
	// is a server-side port; no `.svelte` file learns that the listing moved.
	const { id: _entryId, lookingFor, visibility, contact, ...rest } = row;
	return {
		...rest,
		lookingForMembers: lookingFor === 'members',
		directoryVisibility: visibility,
		directoryContact: contact,
		genres: genres.map((r) => r.value)
	};
}
