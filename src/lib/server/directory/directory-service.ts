import { db } from '$lib/server/db';
import {
	directoryTag,
	type DirectoryTagKind,
	type LookingFor
} from '$lib/server/db/schema/directory';
import { groupMember } from '$lib/server/db/schema/group';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { resolveImageUrl } from '$lib/server/storage';
import { captureException } from '$lib/server/sentry';
import { blockExistsBetween } from '$lib/server/moderation/moderation-service';
import { toBandRef, toMemberRef } from '$lib/server/entity/refs';
import type { BandRef, MemberRef } from '$lib/types/entity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemberFilters = {
	search?: string;
	instruments?: string[];
	genres?: string[];
	lookingForBand?: boolean;
	availableForHire?: boolean;
	teachesLessons?: boolean;
	openToCollaboration?: boolean;
};

export type BandFilters = {
	search?: string;
	genres?: string[];
	lookingForMembers?: boolean;
	/**
	 * What the band is looking *for*, the mirror of `MemberFilters.instruments`.
	 * There was never a `band_instrument` among the tables `directory_tag`
	 * replaced, so until `seeking_instrument` a band could say it wanted members
	 * without saying what for — and this filter had nothing to aim at.
	 */
	seekingInstruments?: string[];
};

// ---------------------------------------------------------------------------
// Tag filtering
// ---------------------------------------------------------------------------

/**
 * "This entry carries one of these tags."
 *
 * `kind` is not optional and not a default. Genres and instruments share one
 * table now, so a filter that omits it still returns rows — a member's
 * instruments would answer a genre filter — and every test that only checks
 * "filtering works" would still pass. `directory-service.spec.ts` renders this
 * fragment to SQL and asserts the predicate is in it.
 *
 * Typed on the caller's `where` shape because it is written against whatever
 * table the query is anchored on, and both halves anchor on `directory_entry`.
 */
function tagCondition<W>(kind: DirectoryTagKind, values: string[]): W {
	return {
		RAW: (table: { id: unknown }, _ops: unknown) =>
			sql`EXISTS (SELECT 1 FROM ${directoryTag} WHERE ${directoryTag.entryId} = ${table.id} AND ${directoryTag.kind} = ${kind} AND ${directoryTag.value} IN (${sql.join(
				values.map((v) => sql`${v}`),
				sql`, `
			)}))`
	} as W;
}

/**
 * The predicates a listing carries regardless of what it is attached to: it is
 * live, it is visible to this audience, and it matches the search term.
 *
 * Members and bands keep separate query builders on purpose — their remaining
 * filters genuinely differ (instruments and three availability booleans on one
 * side, `lookingFor: 'members'` on the other), and folding them into a single
 * `OR` over both subject types would put a member's visibility gate and a
 * band's into one expression. That is the one place in this file where a
 * mistake exposes somebody who opted out. This shares what is actually shared.
 */
function listingConditions<W>(visibility: 'members' | 'public', search?: string): W[] {
	const conditions: W[] = [
		{ deletedAt: { isNull: true } } as W,
		(visibility === 'public'
			? { visibility: 'public' }
			: { visibility: { in: ['members', 'public'] } }) as W
	];
	if (search) conditions.push({ name: { like: `%${search}%` } } as W);
	return conditions;
}

// ---------------------------------------------------------------------------
// Member queries
// ---------------------------------------------------------------------------

type MemberWhere = NonNullable<
	NonNullable<Parameters<typeof db.query.directoryEntry.findMany>[0]>['where']
>;

/**
 * Members read `directory_entry` too, on the same predicate as bands with
 * `userId` in place of `groupId`. That symmetry is the point: the two halves are
 * now one query shape over one table, differing only in which subject the entry
 * is attached to.
 *
 * `user: { deletedAt: { isNull: true } }` is the second soft-delete flag, and it
 * is the one that matters here — `purgeUser` and `deactivateUser` set the user's,
 * not the entry's.
 */
function memberWhereConditions(
	visibility: 'members' | 'public',
	filters?: MemberFilters
): MemberWhere {
	const conditions: MemberWhere[] = [
		{ userId: { isNotNull: true } },
		{ user: { deletedAt: { isNull: true } } },
		...listingConditions<MemberWhere>(visibility, filters?.search)
	];

	if (filters?.instruments?.length) {
		conditions.push(tagCondition<MemberWhere>('instrument', filters.instruments));
	}

	if (filters?.genres?.length) {
		conditions.push(tagCondition<MemberWhere>('genre', filters.genres));
	}

	if (filters?.lookingForBand) {
		conditions.push({ lookingFor: 'band' });
	}

	if (filters?.availableForHire) {
		conditions.push({ availableForHire: true });
	}

	if (filters?.teachesLessons) {
		conditions.push({ teachesLessons: true });
	}

	if (filters?.openToCollaboration) {
		conditions.push({ openToCollaboration: true });
	}

	return { AND: conditions };
}

/**
 * Flattens an entry back into the member shape every caller already draws — the
 * mirror of `mapBandRow`, and for the same reason: no `.svelte` file learns that
 * the listing changed tables.
 *
 * `id`, `image` and `memberSince` come from the USER. `user.image` is
 * better-auth's column and may hold a full OAuth URL rather than an R2 key,
 * which is why `directory_entry.avatarKey` is not the read path for a member.
 */
function mapMemberRow<
	T extends {
		userId: string | null;
		tags: { kind: string; value: string }[];
		lookingFor: string | null;
		contact: unknown;
		user: {
			image?: string | null;
			memberNumber?: number | null;
			pronouns?: string | null;
			createdAt: Date;
			groupMembers?: {
				status: string;
				role?: string | null;
				position?: string | null;
				band: { name: string; slug: string; avatarKey: string | null } | null;
			}[];
		} | null;
	}
>(row: T) {
	const { userId, tags, user, lookingFor, contact, ...rest } = row;
	// Both non-null by the query's own predicate — `userId: { isNotNull: true }`,
	// and a real FK with ON DELETE CASCADE behind it. Drizzle types the relation
	// as nullable because it cannot see the filter; asserting once here keeps
	// `createdAt` a `Date` for the three pages that put it through `new Date()`.
	const subject = user!;
	return {
		...rest,
		id: userId!,
		memberNumber: subject.memberNumber ?? null,
		pronouns: subject.pronouns ?? null,
		image: resolveImageUrl(subject.image),
		createdAt: subject.createdAt,
		instruments: tags.filter((t) => t.kind === 'instrument').map((t) => t.value),
		genres: tags.filter((t) => t.kind === 'genre').map((t) => t.value),
		lookingForBand: lookingFor === 'band',
		directoryContact: contact,
		bands: (subject.groupMembers ?? [])
			.filter((m) => m.status === 'active' && m.band)
			.map((m) => ({
				name: m.band!.name,
				slug: m.band!.slug,
				avatarUrl: resolveImageUrl(m.band!.avatarKey),
				position: m.position ?? null,
				role: m.role ?? null
			}))
	};
}

const memberColumns = {
	userId: true,
	name: true,
	bio: true,
	tagline: true,
	hometown: true,
	lookingFor: true,
	availableForHire: true,
	teachesLessons: true,
	openToCollaboration: true,
	contact: true,
	links: true
} as const;

const memberUserWith = {
	columns: { memberNumber: true, pronouns: true, image: true, createdAt: true },
	with: {
		groupMembers: {
			columns: { status: true, role: true, position: true },
			with: { band: { columns: { name: true, slug: true, avatarKey: true } } }
		}
	}
} as const;

/** Members-only directory — all active, non-opted-out members */
export async function listMembers(filters?: MemberFilters) {
	const rows = await db.query.directoryEntry.findMany({
		where: memberWhereConditions('members', filters),
		with: { tags: true, user: memberUserWith },
		orderBy: { name: 'asc' },
		columns: memberColumns
	});
	return rows.map(mapMemberRow);
}

/**
 * Typeahead candidates for the message composer.
 *
 * Deliberately *not* `listMembers`: that eager-loads tags and every band
 * membership for every matching member, with no limit — fine for a directory
 * page rendered once, ruinous for a query that fires on each keystroke. This
 * selects the three columns a picker draws and stops at `limit`.
 *
 * It reuses `memberWhereConditions('members', …)`, so it can only ever surface
 * members the viewer could already browse in the directory. That is the whole
 * privacy argument for the picker: it shows nothing new.
 *
 * Note what it does **not** filter on: `acceptsDirectMessages`. Hiding or
 * greying out members who have messaging off would tell a sender exactly what
 * `startDirectThread`'s silent drops exist to withhold — a sender who can spot a
 * closed door can tell a decline from an unopened request. Sending stays
 * silently dropped instead. Same reasoning keeps the directory Message button
 * visible for everyone; see `docs/specs/shipped/direct-messages-spec.md`.
 */
export async function searchDirectoryMembers(search: string, viewerId: string, limit = 10) {
	// `tagline` rides along because two members called Chris are otherwise
	// indistinguishable in the list, and picking the wrong recipient for a private
	// message is not a recoverable mistake. It is a directory-public field, so it
	// widens nothing.
	const rows = await db.query.directoryEntry.findMany({
		where: {
			AND: [memberWhereConditions('members', { search }), { userId: { ne: viewerId } }]
		},
		orderBy: { name: 'asc' },
		limit,
		columns: { userId: true, name: true, tagline: true }
	});
	// `id` is the USER's — the composer starts a thread with a person, not a listing.
	return rows.map(({ userId, ...rest }) => ({ id: userId!, ...rest }));
}

/** Public directory — only visibility = 'public' */
export async function listPublicMembers(filters?: MemberFilters) {
	const rows = await db.query.directoryEntry.findMany({
		where: memberWhereConditions('public', filters),
		with: { tags: true, user: memberUserWith },
		orderBy: { name: 'asc' },
		columns: memberColumns
	});
	return rows.map(mapMemberRow);
}

/**
 * Whether a member has filled in enough of their profile to be worth showing in
 * the directory. New accounts are directory-visible by default, so without
 * something like this they appear as a card with nothing on it but a name.
 *
 * The bar is deliberately low — one instrument is enough — because this backs an
 * ambient dashboard nudge, and a nudge that survives a genuine effort to answer
 * it is worse than no nudge. Kept here, next to the directory queries, so a
 * future "hide blank profiles from the directory" change can reuse the same
 * definition rather than inventing a second one.
 */
export async function isProfileComplete(userId: string): Promise<boolean> {
	const row = await db.query.directoryEntry.findFirst({
		where: { userId },
		columns: { tagline: true, bio: true },
		with: {
			tags: { columns: { kind: true }, limit: 1 },
			user: { columns: { image: true } }
		}
	});
	if (!row) return false;

	const hasText = (v: string | null | undefined) => !!v && v.trim().length > 0;
	return (
		hasText(row.tagline) || hasText(row.bio) || hasText(row.user?.image) || row.tags.length > 0
	);
}

/** Single member profile */
export async function getMemberProfile(userId: string, visibility: 'members' | 'public') {
	const row = await db.query.directoryEntry.findFirst({
		where: { AND: [memberWhereConditions(visibility), { userId }] },
		with: { tags: true, user: memberUserWith },
		columns: memberColumns
	});

	if (!row) return null;

	return mapMemberRow(row);
}

// ---------------------------------------------------------------------------
// Band queries
// ---------------------------------------------------------------------------

type BandWhere = NonNullable<
	NonNullable<Parameters<typeof db.query.directoryEntry.findMany>[0]>['where']
>;

/**
 * Bands are read through `directory_entry`, not `group`.
 *
 * The entry is where the listing lives, so anchoring here keeps `ORDER BY name`,
 * the search `LIKE`, the visibility filter and the tag filter all native to the
 * queried table rather than reaching across a join. `groupId: isNotNull` is what
 * says "a listing attached to something CMC manages" — the same predicate reads
 * `userId` for members, which is what lets the two halves merge into one query
 * in phase 3a's last step.
 *
 * Two soft-delete flags have to be checked, not one. `deactivate()` sets both,
 * but a group deleted by any other path would otherwise keep its listing.
 */
function bandWhereConditions(visibility: 'members' | 'public', filters?: BandFilters): BandWhere {
	const conditions: BandWhere[] = [
		{ groupId: { isNotNull: true } },
		// Only bands. A club or committee (phase 5) is a group with an entry and
		// no place on this page.
		{ group: { kind: 'band', deletedAt: { isNull: true } } },
		...listingConditions<BandWhere>(visibility, filters?.search)
	];

	if (filters?.genres?.length) {
		conditions.push(tagCondition<BandWhere>('genre', filters.genres));
	}

	if (filters?.seekingInstruments?.length) {
		conditions.push(tagCondition<BandWhere>('seeking_instrument', filters.seekingInstruments));
	}

	if (filters?.lookingForMembers) {
		conditions.push({ lookingFor: 'members' });
	}

	return { AND: conditions };
}

/**
 * Flattens an entry back into the band shape every caller already draws.
 *
 * The renames are the whole point of doing this here rather than at each call
 * site: `id` is the BAND's id (nothing downstream means the entry — not the
 * card colour hash, not a link, not a later lookup), `contact` goes back to
 * `directoryContact`, and `lookingFor` back to the boolean. Phase 3a is a
 * server-side port with an unchanged wire shape, so no `.svelte` file and no
 * client DTO has to know the listing moved tables.
 */
function mapBandRow<
	T extends {
		groupId: string | null;
		tags: { kind: string; value: string }[];
		lookingFor: string | null;
		contact: unknown;
		group: { slug: string; avatarKey: string | null; members: { status: string }[] } | null;
	}
>(row: T) {
	const { groupId, tags, group, lookingFor, contact, ...rest } = row;
	return {
		...rest,
		id: groupId!,
		slug: group?.slug ?? '',
		// From the GROUP, not the entry. `group.avatarKey` is canonical and its one
		// writer is the avatar route (`/api/bands/[id]/avatar`); the band-service
		// pair that used to duplicate it had no caller and is gone. Reading the
		// entry's copy instead would mean keeping two in sync for no gain, since
		// the group is joined here anyway. The entry's copy exists for an act that
		// has no group.
		avatarKey: group?.avatarKey ?? null,
		genres: tags.filter((t) => t.kind === 'genre').map((t) => t.value),
		memberCount: (group?.members ?? []).filter((m) => m.status === 'active').length,
		lookingForMembers: lookingFor === 'members',
		directoryContact: contact
	};
}

const bandColumns = {
	groupId: true,
	name: true,
	bio: true,
	tagline: true,
	hometown: true,
	foundedYear: true,
	lookingFor: true,
	contact: true,
	links: true
} as const;

const bandGroupWith = {
	columns: { slug: true, avatarKey: true },
	with: { members: { columns: { status: true } } }
} as const;

/** Members-only band directory */
export async function listBands(filters?: BandFilters) {
	const rows = await db.query.directoryEntry.findMany({
		where: bandWhereConditions('members', filters),
		with: { tags: true, group: bandGroupWith },
		orderBy: { name: 'asc' },
		columns: bandColumns
	});
	return rows.map(mapBandRow);
}

/** Public band directory */
export async function listPublicBands(filters?: BandFilters) {
	const rows = await db.query.directoryEntry.findMany({
		where: bandWhereConditions('public', filters),
		with: { tags: true, group: bandGroupWith },
		orderBy: { name: 'asc' },
		columns: bandColumns
	});
	return rows.map(mapBandRow);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * What the viewer still has to fill in before a match can be made.
 *
 * Returned rather than resolved into a message here, because the message is a
 * page's job — but which field is missing is a fact about the data and belongs
 * with the query that could not use it.
 */
export type MatchGap = 'lookingFor' | 'instruments' | 'seekingInstruments' | 'genres';

/** One suggestion, with the overlap that produced it so the card can show its reasoning. */
export type DirectoryMatch = {
	ref: MemberRef | BandRef;
	sharedInstruments: string[];
	sharedGenres: string[];
};

export type DirectoryMatches = {
	/** The viewer's own `lookingFor`, which is what decides who is being looked for. */
	direction: LookingFor | null;
	gaps: MatchGap[];
	matches: DirectoryMatch[];
};

/**
 * How many candidates the database is asked for before ranking happens in JS.
 *
 * Ranking cannot be an `ORDER BY` without a second pass over `directory_tag`
 * per row, and the rows carry their tags anyway — so the cap is what keeps
 * "sort in memory" honest. It is deliberately far above the page's own limit:
 * the collective has tens of bands, not thousands, and a cap that could bite
 * would silently drop the best match rather than the worst.
 */
const MATCH_CANDIDATE_LIMIT = 100;

/** How many make it to the card. */
const MATCH_LIMIT = 6;

/** Instrument and genre overlap, in the order they were tagged. */
function overlap(
	tags: { kind: string; value: string }[],
	kind: DirectoryTagKind,
	wanted: string[]
) {
	const set = new Set(wanted);
	return tags.filter((t) => t.kind === kind && set.has(t.value)).map((t) => t.value);
}

/**
 * Instrument overlap outranks genre overlap, and both together outrank either
 * alone. Two hits of one kind is not better than one — a band that needs a
 * bassist and a drummer is not twice the match for somebody who plays both.
 */
function matchRank(m: DirectoryMatch) {
	return (m.sharedInstruments.length > 0 ? 2 : 0) + (m.sharedGenres.length > 0 ? 1 : 0);
}

function byRankThenName(a: DirectoryMatch, b: DirectoryMatch) {
	return matchRank(b) - matchRank(a) || a.ref.title.localeCompare(b.ref.title);
}

/**
 * "Nobody who has blocked me, and nobody I have blocked."
 *
 * The other side is a *column* here rather than an id, which is why
 * `blockExistsBetween` takes both — a match is a suggestion to open a
 * conversation, and DMs already refuse to open one across a block. A match
 * that ignored it would be a way around the block, which is the one failure in
 * this file that is a trust bug rather than a bad suggestion.
 */
function notBlockedCondition<W>(viewerId: string): W {
	return {
		RAW: (table: { userId: unknown }, _ops: unknown) =>
			sql`NOT ${blockExistsBetween(viewerId, table.userId as never)}`
	} as W;
}

/**
 * Who this member should meet, from the answer they already gave.
 *
 * `directory_entry.lookingFor` is a two-directional column, and until now the
 * only thing it drove was a filter chip on a page a member has to think to
 * visit. This is the same data as a query: **my instruments against their
 * needs, or my needs against what they play, inside a shared genre.**
 *
 * The direction is the viewer's own, never a parameter:
 *
 * | `lookingFor` | Looks for                                                     |
 * | ------------ | ------------------------------------------------------------- |
 * | `'band'`     | Bands wanting members, whose `seeking_instrument` tags meet the viewer's `instrument` tags |
 * | `'members'`  | Members wanting a band, whose `instrument` tags meet the viewer's `seeking_instrument` tags |
 * | unset        | Nothing, and `gaps` says so                                    |
 *
 * **Instrument or genre overlap qualifies; both together ranks first.** The
 * plan states the requirement as "sharing a genre" and the ranking as
 * "instrument and genre, then instrument alone, then genre alone" — and a hard
 * AND makes two of those three tiers unreachable. Taken as an OR both readings
 * survive, genre-only lands last (which is the objection to genre-only
 * matching, answered by ordering rather than exclusion), and a collective this
 * size still fills the card.
 *
 * Everything a listing already withholds, this withholds: `memberWhereConditions`
 * and `bandWhereConditions` carry visibility, both soft-delete flags and the
 * deactivated-account check, and are reused rather than restated. On top of
 * those it excludes the viewer, the viewer's own bands, and anyone on either
 * side of a block.
 */
export async function findMatchesFor(userId: string): Promise<DirectoryMatches> {
	const viewer = await db.query.directoryEntry.findFirst({
		where: { userId },
		columns: { lookingFor: true },
		with: { tags: { columns: { kind: true, value: true } } }
	});

	const direction: LookingFor | null = viewer?.lookingFor ?? null;
	const tagsOf = (kind: DirectoryTagKind) =>
		(viewer?.tags ?? []).filter((t) => t.kind === kind).map((t) => t.value);

	const genres = tagsOf('genre');
	// The viewer's half of the intersection, whichever way they are pointed:
	// what they play when they want a band, what they need when they want members.
	const instruments = direction === 'members' ? tagsOf('seeking_instrument') : tagsOf('instrument');

	const gaps: MatchGap[] = [];
	if (!direction) gaps.push('lookingFor');
	if (instruments.length === 0) {
		gaps.push(direction === 'members' ? 'seekingInstruments' : 'instruments');
	}
	if (genres.length === 0) gaps.push('genres');

	// No direction is not a thin result, it is no question — and with neither
	// kind of tag there is nothing to intersect. Both are for `gaps` to explain.
	if (!direction || (instruments.length === 0 && genres.length === 0)) {
		return { direction, gaps, matches: [] };
	}

	const matches =
		direction === 'band'
			? await bandMatches(userId, instruments, genres)
			: await memberMatches(userId, instruments, genres);

	return { direction, gaps, matches: matches.sort(byRankThenName).slice(0, MATCH_LIMIT) };
}

/** The overlap filter itself: at least one instrument or one genre in common. */
function overlapCondition<W>(
	instrumentKind: DirectoryTagKind,
	instruments: string[],
	genres: string[]
): W {
	const either: W[] = [];
	if (instruments.length) either.push(tagCondition<W>(instrumentKind, instruments));
	if (genres.length) either.push(tagCondition<W>('genre', genres));
	return { OR: either } as W;
}

/** Bands wanting members, for a member wanting a band. */
async function bandMatches(
	userId: string,
	instruments: string[],
	genres: string[]
): Promise<DirectoryMatch[]> {
	// The viewer's own bands. Being told to go meet the band you are already in
	// is the loudest possible way for this card to say it does not know you.
	const own = await db
		.select({ groupId: groupMember.groupId })
		.from(groupMember)
		.where(and(eq(groupMember.userId, userId), eq(groupMember.status, 'active')));
	const ownIds = own.map((r) => r.groupId);

	const conditions: BandWhere[] = [
		bandWhereConditions('members', { lookingForMembers: true }),
		overlapCondition<BandWhere>('seeking_instrument', instruments, genres)
	];
	// Only when there is something to exclude: `notIn []` is not a predicate
	// every dialect renders sensibly.
	if (ownIds.length) conditions.push({ groupId: { notIn: ownIds } });

	const rows = await db.query.directoryEntry.findMany({
		where: { AND: conditions },
		with: { tags: true, group: { columns: { slug: true, avatarKey: true } } },
		orderBy: { name: 'asc' },
		limit: MATCH_CANDIDATE_LIMIT,
		columns: { groupId: true, name: true, tagline: true }
	});

	return rows.map((row) => ({
		// The BAND's id, slug and avatar key — nothing downstream means the entry,
		// and `group.avatarKey` is canonical. Same renames `mapBandRow` does.
		// `subtitle` is overridden because `toBandRef` has none and a tagline is
		// the qualifier a directory card wants.
		ref: {
			...toBandRef({
				id: row.groupId,
				name: row.name,
				slug: row.group?.slug ?? null,
				image: row.group?.avatarKey ?? null
			}),
			subtitle: row.tagline
		} satisfies BandRef,
		sharedInstruments: overlap(row.tags, 'seeking_instrument', instruments),
		sharedGenres: overlap(row.tags, 'genre', genres)
	}));
}

/** Members wanting a band, for a member assembling one. */
async function memberMatches(
	userId: string,
	seeking: string[],
	genres: string[]
): Promise<DirectoryMatch[]> {
	const rows = await db.query.directoryEntry.findMany({
		where: {
			AND: [
				memberWhereConditions('members', { lookingForBand: true }),
				{ userId: { ne: userId } },
				notBlockedCondition<MemberWhere>(userId),
				overlapCondition<MemberWhere>('instrument', seeking, genres)
			]
		},
		with: { tags: true, user: { columns: { image: true, pronouns: true } } },
		orderBy: { name: 'asc' },
		limit: MATCH_CANDIDATE_LIMIT,
		columns: { userId: true, name: true, tagline: true }
	});

	return rows.map((row) => ({
		// The USER's id, and `user.image` rather than the entry's avatar key —
		// better-auth owns that column and it may hold a full OAuth URL. The
		// subtitle is the tagline rather than `toMemberRef`'s email: the directory
		// is where two members called Chris are told apart by what they play, and
		// publishing an address on a suggestion card nobody asked for is worse.
		ref: {
			...toMemberRef({
				id: row.userId,
				name: row.name,
				pronouns: row.user?.pronouns ?? null,
				image: row.user?.image ?? null
			}),
			subtitle: row.tagline
		} satisfies MemberRef,
		sharedInstruments: overlap(row.tags, 'instrument', seeking),
		sharedGenres: overlap(row.tags, 'genre', genres)
	}));
}

// ---------------------------------------------------------------------------
// Public directory aggregate
// ---------------------------------------------------------------------------

export type PublicDirectoryFilters = MemberFilters & { lookingForMembers?: boolean };

/**
 * Public directory listing (members + bands) for the `/directory` page.
 *
 * The page awaits this at the top of its `<script>`, so an unexpected DB error
 * here would surface as an unhandled rejection and crash the async error
 * boundary. Instead we catch, report to Sentry, and return a `failed` sentinel
 * the page can render as an inline error state.
 */
export async function getPublicDirectory(filters: PublicDirectoryFilters = {}) {
	try {
		const [members, bands] = await Promise.all([
			listPublicMembers({
				search: filters.search,
				instruments: filters.instruments,
				genres: filters.genres,
				lookingForBand: filters.lookingForBand,
				availableForHire: filters.availableForHire,
				teachesLessons: filters.teachesLessons,
				openToCollaboration: filters.openToCollaboration
			}),
			listPublicBands({
				search: filters.search,
				genres: filters.genres,
				lookingForMembers: filters.lookingForMembers
			})
		]);

		return {
			members: members.map((m) => ({
				id: m.id,
				name: m.name,
				pronouns: m.pronouns,
				image: m.image,
				tagline: m.tagline,
				instruments: m.instruments,
				genres: m.genres,
				lookingForBand: m.lookingForBand,
				availableForHire: m.availableForHire,
				teachesLessons: m.teachesLessons,
				openToCollaboration: m.openToCollaboration,
				memberSince: m.createdAt,
				bands: m.bands
			})),
			bands: bands.map((b) => ({
				id: b.id,
				name: b.name,
				slug: b.slug,
				tagline: b.tagline,
				avatarUrl: resolveImageUrl(b.avatarKey),
				memberCount: b.memberCount,
				genres: b.genres,
				lookingForMembers: b.lookingForMembers
			})),
			failed: false
		};
	} catch (err) {
		captureException(err);
		return { members: [], bands: [], failed: true };
	}
}

// ---------------------------------------------------------------------------
// Tag suggestions
// ---------------------------------------------------------------------------

/**
 * One table, one query, for what used to be three scans unioned in JS —
 * `user_instrument` for instruments, `user_genre` and `band_genre` for genres,
 * with the genre halves deduped and re-sorted in memory afterwards.
 *
 * These two move in the band PR even though instruments are a member concept,
 * and that is deliberate: they read `directory_tag`, which the backfill already
 * filled for members and bands alike, so they are correct the moment this lands
 * regardless of whether the member half has been ported. Leaving
 * `suggestGenres` reading `band_genre` until then would have meant a band's
 * genres briefly disappearing from the suggestion list the moment band writes
 * moved to `directory_tag`.
 */
async function suggestTags(kind: DirectoryTagKind, prefix: string) {
	const rows = await db
		.selectDistinct({ tag: directoryTag.value })
		.from(directoryTag)
		.where(and(eq(directoryTag.kind, kind), like(directoryTag.value, `${prefix}%`)))
		.orderBy(asc(directoryTag.value))
		.limit(10);

	return rows.map((r) => r.tag);
}

export async function suggestInstruments(prefix: string) {
	return suggestTags('instrument', prefix);
}

export async function suggestGenres(prefix: string) {
	return suggestTags('genre', prefix);
}
