import { db } from '$lib/server/db';
import { userInstrument, userGenre } from '$lib/server/db/schema/authentication';
import { bandGenre } from '$lib/server/db/schema/band';
import { asc, like, sql } from 'drizzle-orm';
import { resolveImageUrl } from '$lib/server/storage';
import { captureException } from '$lib/server/sentry';

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
};

// ---------------------------------------------------------------------------
// Member queries
// ---------------------------------------------------------------------------

type MemberWhere = NonNullable<NonNullable<Parameters<typeof db.query.user.findMany>[0]>['where']>;

function memberWhereConditions(
	visibility: 'members' | 'public',
	filters?: MemberFilters
): MemberWhere {
	const conditions: MemberWhere[] = [{ deletedAt: { isNull: true } }];

	if (visibility === 'public') {
		conditions.push({ directoryVisibility: 'public' });
	} else {
		conditions.push({ directoryVisibility: { in: ['members', 'public'] } });
	}

	if (filters?.search) {
		conditions.push({ name: { like: `%${filters.search}%` } });
	}

	if (filters?.instruments?.length) {
		conditions.push({
			RAW: (table, _ops) =>
				sql`EXISTS (SELECT 1 FROM ${userInstrument} WHERE ${userInstrument.userId} = ${table.id} AND ${userInstrument.instrument} IN (${sql.join(
					filters.instruments!.map((i) => sql`${i}`),
					sql`, `
				)}))`
		});
	}

	if (filters?.genres?.length) {
		conditions.push({
			RAW: (table, _ops) =>
				sql`EXISTS (SELECT 1 FROM ${userGenre} WHERE ${userGenre.userId} = ${table.id} AND ${userGenre.genre} IN (${sql.join(
					filters.genres!.map((g) => sql`${g}`),
					sql`, `
				)}))`
		});
	}

	if (filters?.lookingForBand) {
		conditions.push({ lookingForBand: true });
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

function mapMemberRow<
	T extends {
		instruments: { instrument: string }[];
		genres: { genre: string }[];
		image?: string | null;
		bandMembers?: {
			status: string;
			role?: string | null;
			position?: string | null;
			band: { name: string; slug: string; avatarKey: string | null } | null;
		}[];
	}
>(row: T) {
	const { instruments, genres, bandMembers, image, ...rest } = row;
	return {
		...rest,
		image: resolveImageUrl(image),
		instruments: instruments.map((r) => r.instrument),
		genres: genres.map((r) => r.genre),
		bands: (bandMembers ?? [])
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
	id: true,
	name: true,
	memberNumber: true,
	pronouns: true,
	image: true,
	bio: true,
	tagline: true,
	hometown: true,
	lookingForBand: true,
	availableForHire: true,
	teachesLessons: true,
	openToCollaboration: true,
	directoryContact: true,
	links: true,
	createdAt: true
} as const;

const memberBandsWith = {
	columns: { status: true, role: true, position: true },
	with: { band: { columns: { name: true, slug: true, avatarKey: true } } }
} as const;

/** Members-only directory — all active, non-opted-out members */
export async function listMembers(filters?: MemberFilters) {
	const rows = await db.query.user.findMany({
		where: memberWhereConditions('members', filters),
		with: {
			instruments: true,
			genres: true,
			bandMembers: memberBandsWith
		},
		orderBy: { name: 'asc' },
		columns: memberColumns
	});
	return rows.map(mapMemberRow);
}

/**
 * Typeahead candidates for the message composer.
 *
 * Deliberately *not* `listMembers`: that eager-loads instruments, genres and
 * every band membership for every matching member, with no limit — fine for a
 * directory page rendered once, ruinous for a query that fires on each
 * keystroke. This selects the three columns a picker draws and stops at `limit`.
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
 * visible for everyone; see `docs/specs/direct-messages-spec.md`.
 */
export async function searchDirectoryMembers(search: string, viewerId: string, limit = 10) {
	// `tagline` rides along because two members called Chris are otherwise
	// indistinguishable in the list, and picking the wrong recipient for a private
	// message is not a recoverable mistake. It is a directory-public field, so it
	// widens nothing.
	return db.query.user.findMany({
		where: {
			AND: [memberWhereConditions('members', { search }), { id: { ne: viewerId } }]
		},
		orderBy: { name: 'asc' },
		limit,
		columns: { id: true, name: true, tagline: true }
	});
}

/** Public directory — only directoryVisibility = 'public' */
export async function listPublicMembers(filters?: MemberFilters) {
	const rows = await db.query.user.findMany({
		where: memberWhereConditions('public', filters),
		with: {
			instruments: true,
			genres: true,
			bandMembers: memberBandsWith
		},
		orderBy: { name: 'asc' },
		columns: memberColumns
	});
	return rows.map(mapMemberRow);
}

/**
 * Whether a member has filled in enough of their profile to be worth showing in
 * the directory. New accounts are directory-visible by default (the
 * `directoryVisibility` column defaults to 'members'), so without something like
 * this they appear as a card with nothing on it but a name.
 *
 * The bar is deliberately low — one instrument is enough — because this backs an
 * ambient dashboard nudge, and a nudge that survives a genuine effort to answer
 * it is worse than no nudge. Kept here, next to the directory queries, so a
 * future "hide blank profiles from the directory" change can reuse the same
 * definition rather than inventing a second one.
 */
export async function isProfileComplete(userId: string): Promise<boolean> {
	const row = await db.query.user.findFirst({
		where: { id: userId },
		columns: { tagline: true, bio: true, image: true },
		with: {
			instruments: { columns: { instrument: true }, limit: 1 },
			genres: { columns: { genre: true }, limit: 1 }
		}
	});
	if (!row) return false;

	const hasText = (v: string | null | undefined) => !!v && v.trim().length > 0;
	return (
		hasText(row.tagline) ||
		hasText(row.bio) ||
		hasText(row.image) ||
		row.instruments.length > 0 ||
		row.genres.length > 0
	);
}

/** Single member profile */
export async function getMemberProfile(userId: string, visibility: 'members' | 'public') {
	const conditions: MemberWhere[] = [{ id: userId }, { deletedAt: { isNull: true } }];

	if (visibility === 'public') {
		conditions.push({ directoryVisibility: 'public' });
	} else {
		conditions.push({ directoryVisibility: { in: ['members', 'public'] } });
	}

	const row = await db.query.user.findFirst({
		where: { AND: conditions },
		with: {
			instruments: true,
			genres: true,
			bandMembers: memberBandsWith
		},
		columns: memberColumns
	});

	if (!row) return null;

	return mapMemberRow(row);
}

// ---------------------------------------------------------------------------
// Band queries
// ---------------------------------------------------------------------------

type BandWhere = NonNullable<NonNullable<Parameters<typeof db.query.group.findMany>[0]>['where']>;

function bandWhereConditions(visibility: 'members' | 'public', filters?: BandFilters): BandWhere {
	const conditions: BandWhere[] = [{ deletedAt: { isNull: true } }];

	if (visibility === 'public') {
		conditions.push({ directoryVisibility: 'public' });
	} else {
		conditions.push({ directoryVisibility: { in: ['members', 'public'] } });
	}

	if (filters?.search) {
		conditions.push({ name: { like: `%${filters.search}%` } });
	}

	if (filters?.genres?.length) {
		conditions.push({
			RAW: (table, _ops) =>
				sql`EXISTS (SELECT 1 FROM ${bandGenre} WHERE ${bandGenre.bandId} = ${table.id} AND ${bandGenre.genre} IN (${sql.join(
					filters.genres!.map((g) => sql`${g}`),
					sql`, `
				)}))`
		});
	}

	if (filters?.lookingForMembers) {
		conditions.push({ lookingForMembers: true });
	}

	return { AND: conditions };
}

function mapBandRow<T extends { genres: { genre: string }[]; members: { status: string }[] }>(
	row: T
) {
	const { genres, members, ...rest } = row;
	return {
		...rest,
		genres: genres.map((r) => r.genre),
		memberCount: members.filter((m) => m.status === 'active').length
	};
}

const bandColumns = {
	id: true,
	name: true,
	slug: true,
	bio: true,
	tagline: true,
	hometown: true,
	foundedYear: true,
	avatarKey: true,
	lookingForMembers: true,
	directoryContact: true,
	links: true
} as const;

/** Members-only band directory */
export async function listBands(filters?: BandFilters) {
	const rows = await db.query.group.findMany({
		where: bandWhereConditions('members', filters),
		with: {
			genres: true,
			members: { columns: { status: true } }
		},
		orderBy: { name: 'asc' },
		columns: bandColumns
	});
	return rows.map(mapBandRow);
}

/** Public band directory */
export async function listPublicBands(filters?: BandFilters) {
	const rows = await db.query.group.findMany({
		where: bandWhereConditions('public', filters),
		with: {
			genres: true,
			members: { columns: { status: true } }
		},
		orderBy: { name: 'asc' },
		columns: bandColumns
	});
	return rows.map(mapBandRow);
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

export async function suggestInstruments(prefix: string) {
	const rows = await db
		.selectDistinct({ tag: userInstrument.instrument })
		.from(userInstrument)
		.where(like(userInstrument.instrument, `${prefix}%`))
		.orderBy(asc(userInstrument.instrument))
		.limit(10);

	return rows.map((r) => r.tag);
}

export async function suggestGenres(prefix: string) {
	const [userRows, bandRows] = await Promise.all([
		db
			.selectDistinct({ tag: userGenre.genre })
			.from(userGenre)
			.where(like(userGenre.genre, `${prefix}%`))
			.limit(10),
		db
			.selectDistinct({ tag: bandGenre.genre })
			.from(bandGenre)
			.where(like(bandGenre.genre, `${prefix}%`))
			.limit(10)
	]);

	return [...new Set([...userRows, ...bandRows].map((r) => r.tag))].sort().slice(0, 10);
}
