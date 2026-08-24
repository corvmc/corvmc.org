import { z } from 'zod';
import { LONG_TEXT_MAX } from '$lib/config';
import { error, redirect } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { requireFeature } from '$lib/server/feature-flags';
import { requireBandAdmin } from '$lib/server/band/band-context';
import {
	listMembers,
	searchDirectoryMembers,
	listBands,
	getPublicDirectory as getPublicDirectoryService,
	getMemberProfile as getMemberProfileService,
	suggestInstruments,
	suggestGenres,
	isProfileComplete
} from '$lib/server/directory/directory-service';
import {
	getMemberProfileForEdit,
	updateMemberProfile,
	getBandProfileForEdit,
	updateBandProfile
} from '$lib/server/directory/profile-service';
import {
	listBandEventsUpcoming,
	listBandEventsPast,
	countBandPastEvents,
	listMemberUpcomingShows,
	listMemberPastShows,
	countMemberPastShows
} from '$lib/server/event/event-service';
import { toCalendarEntry } from '$lib/server/event/calendar-entry';
import { PAST_SHOWS_PAGE_SIZE } from '$lib/types/calendar';
import { update as updateBandBasics } from '$lib/server/band/band-service';
import { resolveBandSlug } from '$lib/server/band/band-address-service';
import { resolveImageUrl } from '$lib/server/storage';
import { captureException } from '$lib/server/sentry';
import {
	isMemberRowPrivate,
	isBandProfileHidden,
	toPublicMemberProfile
} from '$lib/utils/directory-display';
import { db } from '$lib/server/db';
import { band, bandMember, bandGenre } from '$lib/server/db/schema/band';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { profileLinkSchema } from '$lib/server/db/schema/authentication';
import type { ProfileLink, DirectoryContact } from '$lib/server/db/schema/authentication';
import { jsonArrayField } from '$lib/utils/zod-json';

// ---------------------------------------------------------------------------
// JSON-encoded form/filter fields
// ---------------------------------------------------------------------------
//
// These all used `.transform((s) => { try { JSON.parse(s) } catch { … } })`.
// On the *save* forms the catch returned `[]`, which is destructive: the value
// goes straight into updateMemberProfile/updateBandProfile, which replace the
// stored array wholesale, so a malformed payload erased the member's
// instruments/genres/links rather than failing. That is the same shape as the
// role wipe fixed in #162. jsonArrayField() reports a field issue instead, so
// the save is rejected and the stored value is left alone — deliberately no
// `.catch([])`.

/** An optional JSON-encoded string-array *filter*. Absent or empty = no filter. */
const arrayFilter = z
	.union([z.literal('').transform(() => undefined), jsonArrayField(z.string(), 'Invalid filter')])
	.optional();

/** A JSON-encoded array of profile links (label + url), as written by LinksField. */
const linksField = jsonArrayField(profileLinkSchema, 'Invalid links');

/** A JSON-encoded array of free-text tags (instruments, genres). */
const tagsField = (message: string) => jsonArrayField(z.string(), message);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const filtersSchema = z.object({
	search: z.string().optional(),
	instruments: arrayFilter,
	genres: arrayFilter,
	lookingForBand: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	availableForHire: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	teachesLessons: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	openToCollaboration: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	lookingForMembers: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined))
});

export const getDirectoryMembers = query(filtersSchema, async (filters) => {
	requireUser();
	return listMembers({
		search: filters.search,
		instruments: filters.instruments,
		genres: filters.genres,
		lookingForBand: filters.lookingForBand,
		availableForHire: filters.availableForHire,
		teachesLessons: filters.teachesLessons,
		openToCollaboration: filters.openToCollaboration
	});
});

export const getDirectoryBands = query(filtersSchema, async (filters) => {
	requireUser();
	const bands = await listBands({
		search: filters.search,
		genres: filters.genres,
		lookingForMembers: filters.lookingForMembers
	});
	return bands.map((b) => ({
		...b,
		avatarUrl: resolveImageUrl(b.avatarKey)
	}));
});

/**
 * Recipient candidates for the message composer.
 *
 * Scoped to the directory the caller can already browse, and deliberately blind
 * to whether a candidate accepts messages — see `searchDirectoryMembers`. The
 * composer is allowed to offer someone unreachable; `startDirectThread` drops
 * the message silently, which is the point.
 */
export const searchMessageRecipients = query(
	z.object({ search: z.string().trim().min(2).max(100) }),
	async ({ search }) => {
		await requireFeature('directMessages');
		const user = requireUser();
		return searchDirectoryMembers(search, user.id);
	}
);

export const getDirectoryMember = query(z.string(), async (userId) => {
	requireUser();
	return getMemberProfileService(userId, 'members');
});

export const getDirectoryBand = query(z.string(), async (slug) => {
	requireUser();
	return loadBandProfile(slug, 'members');
});

// ---------------------------------------------------------------------------
// Public directory queries
// ---------------------------------------------------------------------------

const publicFiltersSchema = z.object({
	search: z.string().optional(),
	instruments: arrayFilter,
	genres: arrayFilter,
	lookingForBand: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	availableForHire: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	teachesLessons: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	openToCollaboration: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined)),
	lookingForMembers: z
		.string()
		.optional()
		.transform((v) => (v === 'true' ? true : undefined))
});

export const getPublicDirectory = query(publicFiltersSchema, (filters) =>
	getPublicDirectoryService(filters)
);

export const getPublicBandProfile = query(z.string(), async (slug) => {
	return loadBandProfile(slug, 'public');
});

/**
 * Shared band-profile loader for the members and public views. In the public
 * view, members whose own directory visibility isn't `public` are returned as
 * locked, unlinked rows (`private: true`) — keeping the lineup count honest
 * without exposing them.
 */
async function loadBandProfile(slug: string, visibility: 'members' | 'public') {
	const [row] = await db
		.select({
			id: band.id,
			name: band.name,
			slug: band.slug,
			bio: band.bio,
			tagline: band.tagline,
			hometown: band.hometown,
			foundedYear: band.foundedYear,
			avatarKey: band.avatarKey,
			lookingForMembers: band.lookingForMembers,
			directoryContact: band.directoryContact,
			links: band.links,
			directoryVisibility: band.directoryVisibility,
			memberCount: sql<number>`cast(count(case when ${bandMember.status} = 'active' then 1 end) as integer)`
		})
		.from(band)
		.leftJoin(bandMember, eq(bandMember.bandId, band.id))
		.where(and(eq(band.slug, slug), isNull(band.deletedAt)))
		.groupBy(band.id);

	if (!row) {
		// The band may have changed its address and released this slug. Checking
		// only on a miss is deliberate: folding this into the visibility branch
		// below would make a hidden band's old slug redirect to its new one,
		// disclosing both its existence and its current address past the gate.
		const moved = await resolveBandSlug(slug);
		if (moved?.kind === 'moved' && moved.slug !== slug) {
			// 302, not 301 — a released address is claimable, so the redirect has to
			// be revocable.
			redirect(
				302,
				visibility === 'public'
					? `/directory/bands/${moved.slug}`
					: `/member/directory/bands/${moved.slug}`
			);
		}
		throw error(404, 'Band not found');
	}

	// A band that opted out of this view's directory must not resolve by URL
	// either — same 404 contract as member profiles.
	if (isBandProfileHidden(visibility, row.directoryVisibility)) {
		throw error(404, 'Band not found');
	}

	const genres = await db
		.select({ genre: bandGenre.genre })
		.from(bandGenre)
		.where(eq(bandGenre.bandId, row.id));

	const members = await db
		.select({
			id: bandMember.id,
			userId: bandMember.userId,
			role: bandMember.role,
			position: bandMember.position,
			alias: bandMember.alias,
			userName: user.name,
			userImage: user.image,
			userVisibility: user.directoryVisibility
		})
		.from(bandMember)
		.innerJoin(user, eq(user.id, bandMember.userId))
		.where(and(eq(bandMember.bandId, row.id), eq(bandMember.status, 'active')))
		.orderBy(
			sql`case ${bandMember.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
			user.name
		);

	return {
		band: {
			id: row.id,
			name: row.name,
			slug: row.slug,
			bio: row.bio,
			tagline: row.tagline,
			hometown: row.hometown,
			foundedYear: row.foundedYear,
			avatarUrl: resolveImageUrl(row.avatarKey),
			memberCount: row.memberCount,
			genres: genres.map((r) => r.genre),
			lookingForMembers: row.lookingForMembers,
			directoryContact: row.directoryContact as DirectoryContact | null,
			links: (row.links as ProfileLink[] | null) ?? []
		},
		members: members.map((m) => {
			// In public, a member who hasn't opted their own profile public is
			// shown as a locked row (no name, no link) so the count stays honest.
			const isPrivate = isMemberRowPrivate(visibility, m.userVisibility);
			return {
				id: m.id,
				userId: m.userId,
				role: m.role,
				position: m.position,
				// Withhold identifying details for private members in public. The
				// alias is withheld with them: a stage name is more public than an
				// account name, not an exemption from the private-row rule.
				userName: isPrivate ? null : (m.alias ?? m.userName),
				userImage: isPrivate ? null : resolveImageUrl(m.userImage),
				private: isPrivate
			};
		})
	};
}

export const getPublicMemberProfile = query(z.string(), async (id) => {
	const member = await getMemberProfileService(id, 'public');
	if (!member) throw error(404, 'Member not found');

	return { member: toPublicMemberProfile(member) };
});

// ---------------------------------------------------------------------------
// Shows (ShowsBox) — band's own shows + member's aggregated shows
// ---------------------------------------------------------------------------

/** Paged past-shows input: whose shows, and how far down the list. */
const pastShowsSchema = z.object({
	id: z.string(),
	offset: z.number().int().min(0).default(0)
});

/** Splits a limit+1 fetch into a page of entries plus the hasMore flag. */
function toPastPage(rows: Parameters<typeof toCalendarEntry>[0][]) {
	return {
		events: rows.slice(0, PAST_SHOWS_PAGE_SIZE).map(toCalendarEntry),
		hasMore: rows.length > PAST_SHOWS_PAGE_SIZE
	};
}

/** Upcoming + first page of past shows for a band's own profile. Takes a band id. */
export const getBandShows = query(z.string(), async (bandId) => {
	const [upcoming, past, pastCount] = await Promise.all([
		listBandEventsUpcoming(bandId),
		listBandEventsPast(bandId, { limit: PAST_SHOWS_PAGE_SIZE, offset: 0 }),
		countBandPastEvents(bandId)
	]);
	const page = toPastPage(past);
	return {
		pastCount,
		past: page.events,
		pastHasMore: page.hasMore,
		upcoming: upcoming.map(toCalendarEntry)
	};
});

/** Older pages of a band's past shows, for the ShowsBox pager. */
export const getBandPastShows = query(pastShowsSchema, async ({ id, offset }) =>
	toPastPage(await listBandEventsPast(id, { limit: PAST_SHOWS_PAGE_SIZE, offset }))
);

/** Upcoming + first page of past shows aggregated across a member's active bands. */
export const getMemberShows = query(z.string(), async (userId) => {
	const [upcoming, past, pastCount] = await Promise.all([
		listMemberUpcomingShows(userId),
		listMemberPastShows(userId, { limit: PAST_SHOWS_PAGE_SIZE, offset: 0 }),
		countMemberPastShows(userId)
	]);
	const page = toPastPage(past);
	return {
		pastCount,
		past: page.events,
		pastHasMore: page.hasMore,
		upcoming: upcoming.map(toCalendarEntry)
	};
});

/** Older pages of a member's aggregated past shows. */
export const getMemberPastShows = query(pastShowsSchema, async ({ id, offset }) =>
	toPastPage(await listMemberPastShows(id, { limit: PAST_SHOWS_PAGE_SIZE, offset }))
);

export const getMyDirectoryVisibility = query(z.void(), async () => {
	const { locals } = getRequestEvent();
	if (!locals.user) return null;
	try {
		const [row] = await db
			.select({ directoryVisibility: user.directoryVisibility })
			.from(user)
			.where(eq(user.id, locals.user.id));
		return row?.directoryVisibility ?? null;
	} catch (err) {
		captureException(err);
		return null;
	}
});

export const getInstrumentSuggestions = query(z.void(), async () => {
	requireUser();
	return suggestInstruments('');
});

export const getGenreSuggestions = query(z.void(), async () => {
	requireUser();
	return suggestGenres('');
});

// ---------------------------------------------------------------------------
// Member profile queries & forms
// ---------------------------------------------------------------------------

export const getMemberProfile = query(z.void(), async () => {
	const user = requireUser();
	const profile = await getMemberProfileForEdit(user.id);
	if (!profile) return null;
	return { ...profile, avatarUrl: resolveImageUrl(profile.image) };
});

const memberProfileSchema = z.object({
	tagline: z.string().max(150).optional().default(''),
	bio: z.string().max(LONG_TEXT_MAX).optional().default(''),
	hometown: z.string().max(150).optional().default(''),
	instruments: tagsField('Invalid instruments'),
	genres: tagsField('Invalid genres'),
	lookingForBand: z.boolean().default(false),
	availableForHire: z.boolean().default(false),
	teachesLessons: z.boolean().default(false),
	openToCollaboration: z.boolean().default(false),
	directoryVisibility: z.enum(['hidden', 'members', 'public']).default('members'),
	contactEmail: z.string().max(255).optional().default(''),
	contactPhone: z.string().max(30).optional().default(''),
	contactSocial: z.string().max(255).optional().default(''),
	contactPublic: z.boolean().default(false),
	links: linksField
});

export const saveMemberProfile = form(memberProfileSchema, async (data) => {
	const user = requireUser();

	const contact = {
		...(data.contactEmail ? { email: data.contactEmail } : {}),
		...(data.contactPhone ? { phone: data.contactPhone } : {}),
		...(data.contactSocial ? { social: data.contactSocial } : {})
	};
	// Personal contact defaults to members-only; the member opts it into the
	// public profile explicitly. contactForView() reads this on the public side.
	const directoryContact =
		Object.keys(contact).length > 0
			? { ...contact, visibility: data.contactPublic ? 'public' : 'members' }
			: undefined;

	await updateMemberProfile(user.id, {
		tagline: data.tagline || undefined,
		bio: data.bio || undefined,
		hometown: data.hometown || undefined,
		instruments: data.instruments,
		genres: data.genres,
		lookingForBand: data.lookingForBand,
		availableForHire: data.availableForHire,
		teachesLessons: data.teachesLessons,
		openToCollaboration: data.openToCollaboration,
		directoryVisibility: data.directoryVisibility,
		directoryContact,
		links: data.links
	});

	void getMemberProfile().refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Band profile queries & forms
// ---------------------------------------------------------------------------

export const getBandProfile = query(z.void(), async () => {
	const { band } = await requireBandAdmin();
	return getBandProfileForEdit(band.id);
});

const bandProfileSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	bio: z.string().max(LONG_TEXT_MAX).optional().default(''),
	tagline: z.string().max(150).optional().default(''),
	hometown: z.string().max(150).optional().default(''),
	foundedYear: z.string().max(16).optional().default(''),
	genres: tagsField('Invalid genres'),
	lookingForMembers: z.boolean().default(false),
	directoryVisibility: z.enum(['hidden', 'members', 'public']).default('public'),
	contactEmail: z.string().max(255).optional().default(''),
	contactPhone: z.string().max(30).optional().default(''),
	contactSocial: z.string().max(255).optional().default(''),
	links: linksField
});

export const saveBandProfile = form(bandProfileSchema, async (data) => {
	const { user, band } = await requireBandAdmin();

	const contact = {
		...(data.contactEmail ? { email: data.contactEmail } : {}),
		...(data.contactPhone ? { phone: data.contactPhone } : {}),
		...(data.contactSocial ? { social: data.contactSocial } : {})
	};

	await updateBandBasics(band.id, { name: data.name, bio: data.bio });

	await updateBandProfile(band.id, user.id, {
		tagline: data.tagline || undefined,
		hometown: data.hometown || undefined,
		foundedYear: data.foundedYear || undefined,
		genres: data.genres,
		lookingForMembers: data.lookingForMembers,
		directoryVisibility: data.directoryVisibility,
		directoryContact: Object.keys(contact).length > 0 ? contact : undefined,
		links: data.links
	});

	// Safe to refresh unconditionally: `getBandProfile` resolves its band from
	// `params.slug`, which for a remote request is the slug the client sent, and
	// renaming no longer rotates it (see band-service `update`). Only the explicit
	// address change moves a slug, and that one deliberately refreshes nothing.
	void getBandProfile().refresh();

	return { success: true };
});

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserDirectoryProfile = query(z.string(), async (userId) => {
	await requireStaff();
	const [profile, complete] = await Promise.all([
		getMemberProfileForEdit(userId),
		isProfileComplete(userId)
	]);
	return { profile, complete };
});
