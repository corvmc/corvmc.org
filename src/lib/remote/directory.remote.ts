import { z } from 'zod';
import { LONG_TEXT_MAX } from '$lib/config';
import { error, redirect } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireCapability, requireUser } from '$lib/server/authorization';
import { requireFeature, getAllFeatureFlags } from '$lib/server/feature-flags';
import { requireGroupRole } from '$lib/server/group/group-context';
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
import { isFeatureEnabled } from '$lib/server/feature-flags';
import { listPublishedReleasesForBand } from '$lib/server/audio/audio-service';
import { captureException } from '$lib/server/sentry';
import { getMe } from './layout.remote';
import {
	isMemberRowPrivate,
	isBandProfileHidden,
	toPublicMemberProfile
} from '$lib/utils/directory-display';
import { db } from '$lib/server/db';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { groupMember } from '$lib/server/db/schema/group';
import { group } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { profileLinkSchema } from '$lib/server/db/schema/authentication';
import type { ProfileLink, DirectoryContact } from '$lib/server/db/schema/authentication';
import { jsonArrayField } from '$lib/utils/zod-json';
import { getByUserId as getInstructorByUserId } from '$lib/server/instructor/instructor-service';
import { publicContactStatus } from '$lib/server/instructor/instructor-directory-service';

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

/**
 * The member directory's one load-bearing query.
 *
 * Four queries used to leave this component at once — both lists plus the two suggestion sets
 * that fill the filter chips — and all four re-fired on every keystroke that moved `filters`.
 * Past kit 2.64 a component holding several in flight renders its error boundary instead of the
 * page. One request now, whatever the filters do.
 *
 * The suggestions do not depend on `filters` and are recomputed with them, which is the one cost
 * of folding them in. It buys nothing to split them back out: the request happens anyway.
 */
export const getMemberDirectory = query(filtersSchema, async (filters) => {
	requireUser();

	// The services rather than `getDirectoryMembers`/`getDirectoryBands`: `filtersSchema` has
	// `.transform()` steps, so a query's parsed output is not its own input type and handing one
	// straight to the other does not compile. The two stay exported for nothing in particular —
	// this page is their only caller — but re-deriving the list logic here would be worse.
	const [members, rawBands, instrumentSuggestions, genreSuggestions] = await Promise.all([
		listMembers({
			search: filters.search,
			instruments: filters.instruments,
			genres: filters.genres,
			lookingForBand: filters.lookingForBand,
			availableForHire: filters.availableForHire,
			teachesLessons: filters.teachesLessons,
			openToCollaboration: filters.openToCollaboration
		}),
		listBands({
			search: filters.search,
			genres: filters.genres,
			lookingForMembers: filters.lookingForMembers
		}),
		getInstrumentSuggestions(),
		getGenreSuggestions()
	]);

	const bands = rawBands.map((b) => ({ ...b, avatarUrl: resolveImageUrl(b.avatarKey) }));

	return { members, bands, instrumentSuggestions, genreSuggestions };
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

/**
 * The member directory profile page's one load-bearing query.
 *
 * It used to be three — the profile, `getMemberShows`, and `getMemberLayout` for two booleans
 * — awaited side by side in the component. Past kit 2.64 that shape does not render at all: a
 * component holding several remote queries in flight blows up inside Svelte's reactivity, which
 * is what `TypeError: null is not an object` on the band twin (JAVASCRIPT-SVELTEKIT-1V) was.
 * See `custom/no-concurrent-remote-queries`.
 *
 * The layout query is not composed in — the page wanted two flags off it, not a nav, and
 * `getMemberLayout` is refreshed from seven places that have nothing to do with this page.
 * The permission decisions are resolved here instead, which is where they belonged.
 */
export const getDirectoryMember = query(z.string(), async (userId) => {
	const viewer = requireUser();

	const [profile, shows, features] = await Promise.all([
		getMemberProfileService(userId, 'members'),
		getMemberShows(userId),
		getAllFeatureFlags()
	]);

	return {
		profile,
		shows,
		viewer: {
			canReport: viewer.id !== userId,
			// No "message yourself" button. Whether they will actually receive it depends on
			// blocks and their own messaging switch — checked server-side and deliberately not
			// reflected here: showing or hiding this would tell the sender things the
			// silent-drop design keeps from them.
			canMessage: features.directMessages && viewer.id !== userId
		}
	};
});

/** The band directory profile page's one load-bearing query. See `getDirectoryMember`. */
export const getDirectoryBand = query(z.string(), async (slug) => {
	const viewer = requireUser();

	// Serial, because the shows are keyed by the band id the profile resolves — but both hops
	// are local to the server, where the fan-out was three network round trips.
	const profile = await loadBandProfile(slug, 'members');
	const shows = await getBandShows(profile.band.id);

	return {
		...profile,
		shows,
		viewer: {
			canReport: !profile.members.some((m) => m.userId === viewer.id)
		}
	};
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
			id: group.id,
			// The entry id, needed for the genre lookup below. Distinct from
			// `id` on purpose: nothing outside this function means the entry.
			entryId: directoryEntry.id,
			name: group.name,
			slug: group.slug,
			bio: directoryEntry.bio,
			tagline: directoryEntry.tagline,
			hometown: directoryEntry.hometown,
			foundedYear: directoryEntry.foundedYear,
			avatarKey: group.avatarKey,
			lookingFor: directoryEntry.lookingFor,
			directoryContact: directoryEntry.contact,
			links: directoryEntry.links,
			// Both soft-delete flags: `deactivate()` sets the pair, but a group
			// deleted by any other path would otherwise keep a live listing.
			entryDeletedAt: directoryEntry.deletedAt,
			directoryVisibility: directoryEntry.visibility,
			memberCount: sql<number>`cast(count(case when ${groupMember.status} = 'active' then 1 end) as integer)`
		})
		.from(group)
		// INNER, not left: the listing is the profile. A group with no entry has
		// no public page, which is what a club or committee (phase 5) is.
		.innerJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(and(eq(group.slug, slug), isNull(group.deletedAt), isNull(directoryEntry.deletedAt)))
		.groupBy(group.id);

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
		.select({ value: directoryTag.value })
		.from(directoryTag)
		.where(and(eq(directoryTag.entryId, row.entryId), eq(directoryTag.kind, 'genre')));

	const members = await db
		.select({
			id: groupMember.id,
			userId: groupMember.userId,
			role: groupMember.role,
			position: groupMember.position,
			alias: groupMember.alias,
			userName: user.name,
			userImage: user.image,
			// The member's OWN directory visibility, which decides whether they are
			// shown as a locked row on a public band page. It moved to the listing
			// table in phase 3a; reading `user.directory_visibility` here meant this
			// gate was consulting a column nothing had written since, so a member
			// who changed their visibility kept the old answer.
			//
			// LEFT, and a missing entry falls back to 'members' below — the safer
			// direction, since 'members' hides the row from the public page.
			userVisibility: directoryEntry.visibility
		})
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.leftJoin(directoryEntry, eq(directoryEntry.userId, user.id))
		.where(and(eq(groupMember.groupId, row.id), eq(groupMember.status, 'active')))
		.orderBy(
			sql`case ${groupMember.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
			user.name
		);

	/**
	 * The band's published records, folded into this query rather than fetched
	 * separately: the page already chains one follow-up for shows, and
	 * `custom/no-concurrent-remote-queries` is there because past kit 2.64 a
	 * second await beside the first renders the error boundary instead of the
	 * page.
	 *
	 * `isFeatureEnabled` rather than `requireFeature` — a switched-off storefront
	 * must leave the profile rendering, just without a discography.
	 */
	const releases = (await isFeatureEnabled('bandAudio'))
		? await listPublishedReleasesForBand(row.id)
		: [];

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
			genres: genres.map((r) => r.value),
			lookingForMembers: row.lookingFor === 'members',
			releases,
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
			.select({ directoryVisibility: directoryEntry.visibility })
			.from(directoryEntry)
			.where(eq(directoryEntry.userId, locals.user.id));
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
	seekingInstruments: tagsField('Invalid instruments'),
	genres: tagsField('Invalid genres'),
	// The column itself, not a boolean: a member can point it either way, and
	// "putting a band together" is the direction that was previously unreachable
	// from this form — the whole `members` half of matching depended on it.
	// `''` is the empty option, and lands as null.
	lookingFor: z.enum(['', 'members', 'band']).default(''),
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
		seekingInstruments: data.seekingInstruments,
		genres: data.genres,
		lookingFor: data.lookingFor || null,
		availableForHire: data.availableForHire,
		teachesLessons: data.teachesLessons,
		openToCollaboration: data.openToCollaboration,
		directoryVisibility: data.directoryVisibility,
		directoryContact,
		links: data.links
	});

	void getMemberProfileEditor().refresh();
	return { success: true };
});

/**
 * The member profile editor's one load-bearing query.
 *
 * The page resolves everything before rendering and hands `ProfileForm` plain props, because the
 * form must not live in a component whose script awaits: a top-level await marks every later
 * declaration blocked, turning each `bind:value` in the template into an async derived — the
 * churn behind `JAVASCRIPT-SVELTEKIT-W`. That is still true. What changed is the count: three
 * sequential awaits were three round trips before first paint, and one await is one.
 *
 * `getInstrumentSuggestions` and `getGenreSuggestions` stay exported — `/member/directory` reads
 * them for its filter chips, which is a different page with a different refresh story.
 */
export const getMemberProfileEditor = query(z.void(), async () => {
	const currentUser = requireUser();

	// Teaching rides along rather than being fetched by the card that needs it.
	// `custom/no-concurrent-remote-queries` refuses a page that fans several
	// remote queries out at once, and it is right to: past kit 2.64 that shape
	// renders as `effect_update_depth_exceeded`. Assembling on the server is what
	// the rule asks for, and it is one round trip instead of three.
	const [profile, instrumentSuggestions, genreSuggestions, instructor, contactStatus] =
		await Promise.all([
			getMemberProfile(),
			getInstrumentSuggestions(),
			getGenreSuggestions(),
			getInstructorByUserId(currentUser.id),
			publicContactStatus(currentUser.id)
		]);

	return {
		profile,
		instrumentSuggestions,
		genreSuggestions,
		teaching: {
			instructor,
			hasPublicContact: contactStatus.hasPublicContact,
			hasAnyContact: contactStatus.hasAnyContact
		}
	};
});

// ---------------------------------------------------------------------------
// Band profile queries & forms
// ---------------------------------------------------------------------------

export const getBandProfile = query(z.string(), async (slug) => {
	const { group: band } = await requireGroupRole({ slug }, 'admin');
	return getBandProfileForEdit(band.id);
});

const bandProfileSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1, 'Name is required').max(200),
	bio: z.string().max(LONG_TEXT_MAX).optional().default(''),
	tagline: z.string().max(150).optional().default(''),
	hometown: z.string().max(150).optional().default(''),
	foundedYear: z.string().max(16).optional().default(''),
	genres: tagsField('Invalid genres'),
	seekingInstruments: tagsField('Invalid instruments'),
	lookingForMembers: z.boolean().default(false),
	directoryVisibility: z.enum(['hidden', 'members', 'public']).default('public'),
	contactEmail: z.string().max(255).optional().default(''),
	contactPhone: z.string().max(30).optional().default(''),
	contactSocial: z.string().max(255).optional().default(''),
	links: linksField
});

export const saveBandProfile = form(bandProfileSchema, async (data) => {
	const { user, group: band } = await requireGroupRole({ slug: data.slug }, 'admin');

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
		seekingInstruments: data.seekingInstruments,
		lookingForMembers: data.lookingForMembers,
		directoryVisibility: data.directoryVisibility,
		directoryContact: Object.keys(contact).length > 0 ? contact : undefined,
		links: data.links
	});

	// Safe to refresh on the submitted slug: renaming no longer rotates it (see
	// band-service `update`). Only the explicit address change moves a slug, and
	// that one deliberately refreshes nothing.
	void getBandProfileEditor(data.slug).refresh();

	return { success: true };
});

/** The band profile editor's one load-bearing query. See `getMemberProfileEditor`. */
export const getBandProfileEditor = query(z.string(), async (slug) => {
	// The instrument suggestions ride along for the "what we're looking for"
	// field. Deliberately the same vocabulary members tag themselves with — a
	// free-text field here would let a band ask for something no member has ever
	// written, and the match would silently never fire.
	const [profile, genreSuggestions, instrumentSuggestions] = await Promise.all([
		getBandProfile(slug),
		getGenreSuggestions(),
		getInstrumentSuggestions()
	]);
	return { profile, genreSuggestions, instrumentSuggestions };
});

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserDirectoryProfile = query(z.string(), async (userId) => {
	await requireCapability('user.read');
	const [profile, complete] = await Promise.all([
		getMemberProfileForEdit(userId),
		isProfileComplete(userId)
	]);
	return { profile, complete };
});

/**
 * The public directory's one load-bearing query.
 *
 * `getMe` is the notable one: `(public)/+layout.svelte` already holds it, and the page awaited it
 * again purely to decide whether to show the "your profile is hidden" prompt. Two remote queries
 * in one component is the shape that stops the page rendering past kit 2.64. Reading it here
 * costs nothing — Kit dedupes a remote query per request, so the layout's call and this one are
 * one read — and it keeps the layout free to pass `user` to the header as a plain prop.
 */
export const getPublicDirectoryPage = query(z.void(), async () => {
	const [directory, viewer, visibility] = await Promise.all([
		getPublicDirectory({}),
		getMe(),
		getMyDirectoryVisibility()
	]);

	return { directory, viewer, visibility };
});

/**
 * The public member profile's one load-bearing query.
 *
 * A wrapper rather than folding the shows into `getPublicMemberProfile`, because that query is
 * the public-facing privacy boundary and has a test suite pinned to it directly
 * (`directory.remote.test.ts`) — worth leaving exactly as it is.
 */
export const getPublicMemberProfilePage = query(z.string(), async (id) => {
	const [profile, shows] = await Promise.all([getPublicMemberProfile(id), getMemberShows(id)]);
	return { ...profile, shows };
});
