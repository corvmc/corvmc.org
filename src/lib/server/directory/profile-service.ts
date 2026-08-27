import { db } from '$lib/server/db';
import { user, userInstrument, userGenre } from '$lib/server/db/schema/authentication';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { getOrCreateGroupEntryId, replaceTags } from './entry-service';
import { groupMember } from '$lib/server/db/schema/group';
import { eq, and } from 'drizzle-orm';
import { deleteObject, uploadFile } from '$lib/server/storage';
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
	let mergedContact: DirectoryContact | null = null;
	if (data.directoryContact) {
		const [existing] = await db
			.select({ directoryContact: user.directoryContact })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		const prev = (existing?.directoryContact as DirectoryContact) ?? {};
		mergedContact = validateContact({ ...prev, ...data.directoryContact });
	}

	const queries: BatchItem<'sqlite'>[] = [
		db
			.update(user)
			.set({
				bio: data.bio ? sanitizeBio(data.bio).slice(0, MAX_BIO) || null : null,
				tagline: data.tagline?.slice(0, MAX_TAGLINE) ?? null,
				hometown: data.hometown?.slice(0, MAX_TAGLINE) || null,
				lookingForBand: data.lookingForBand ?? false,
				availableForHire: data.availableForHire ?? false,
				teachesLessons: data.teachesLessons ?? false,
				openToCollaboration: data.openToCollaboration ?? false,
				directoryVisibility: data.directoryVisibility ?? 'members',
				directoryContact: mergedContact,
				links: data.links ? validateLinks(data.links) : null,
				updatedAt: new Date()
			})
			.where(eq(user.id, userId))
	];

	if (data.instruments !== undefined) {
		queries.push(db.delete(userInstrument).where(eq(userInstrument.userId, userId)));
		const tags = validateTags(data.instruments);
		if (tags.length > 0) {
			queries.push(
				db.insert(userInstrument).values(tags.map((instrument) => ({ userId, instrument })))
			);
		}
	}

	if (data.genres !== undefined) {
		queries.push(db.delete(userGenre).where(eq(userGenre.userId, userId)));
		const tags = validateTags(data.genres);
		if (tags.length > 0) {
			queries.push(db.insert(userGenre).values(tags.map((genre) => ({ userId, genre }))));
		}
	}

	await db.batch(queries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/** Load current profile data for the edit form */
export async function getMemberProfileForEdit(userId: string) {
	const [row] = await db
		.select({
			name: user.name,
			bio: user.bio,
			tagline: user.tagline,
			hometown: user.hometown,
			image: user.image,
			lookingForBand: user.lookingForBand,
			availableForHire: user.availableForHire,
			teachesLessons: user.teachesLessons,
			openToCollaboration: user.openToCollaboration,
			directoryVisibility: user.directoryVisibility,
			directoryContact: user.directoryContact,
			links: user.links
		})
		.from(user)
		.where(eq(user.id, userId));

	if (!row) return null;

	const instruments = await db
		.select({ instrument: userInstrument.instrument })
		.from(userInstrument)
		.where(eq(userInstrument.userId, userId));

	const genres = await db
		.select({ genre: userGenre.genre })
		.from(userGenre)
		.where(eq(userGenre.userId, userId));

	return {
		...row,
		instruments: instruments.map((r) => r.instrument),
		genres: genres.map((r) => r.genre)
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
	const [row] = await db
		.select({ image: user.image })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	// Only delete a previously-uploaded avatar key, not an external OAuth URL.
	if (row?.image && !row.image.startsWith('http')) {
		try {
			await deleteObject(row.image);
		} catch {
			// Old avatar may not exist — that's fine
		}
	}

	const key = mediaKey('users/avatars', userId, contentType);
	await uploadFile(buffer, key, contentType);

	await db.update(user).set({ image: key, updatedAt: new Date() }).where(eq(user.id, userId));
	return key;
}

/** Remove a user's avatar from storage and clear `user.image`. */
export async function clearUserAvatar(userId: string) {
	const [row] = await db
		.select({ image: user.image })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (row?.image && !row.image.startsWith('http')) {
		try {
			await deleteObject(row.image);
		} catch {
			// Avatar may not exist — that's fine
		}
	}

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
