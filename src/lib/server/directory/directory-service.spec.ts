import { describe, it, expect, vi, beforeEach } from 'vitest';

// getPublicDirectory aggregates listPublicMembers + listPublicBands, which hit
// D1 via `db.query.*.findMany` and R2 via resolveImageUrl. Mock at those
// boundaries so the real aggregation/try-catch runs without a DB or storage.
const { userFindMany, userFindFirst, bandFindMany, captureException } = vi.hoisted(() => ({
	userFindMany: vi.fn(),
	userFindFirst: vi.fn(),
	bandFindMany: vi.fn(),
	captureException: vi.fn()
}));

// Bands read `directory_entry` since phase 3a, so the band mock moved with them.
// The name is unchanged on purpose: what it stands for — "the query behind the
// band directory" — did not.
vi.mock('$lib/server/db', () => ({
	db: {
		query: {
			user: { findMany: userFindMany, findFirst: userFindFirst },
			directoryEntry: { findMany: bandFindMany }
		}
	}
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string | null) => k }));
vi.mock('$lib/server/sentry', () => ({ captureException }));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { sql, type SQL } from 'drizzle-orm';
import { getPublicDirectory, listMembers, listBands, isProfileComplete } from './directory-service';

/** Pull the `AND` condition array out of the `where` passed to a findMany mock. */
function whereConditions(mock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
	const arg = mock.mock.calls[0]?.[0] as { where?: { AND?: Record<string, unknown>[] } };
	return arg?.where?.AND ?? [];
}

describe('member filters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userFindMany.mockResolvedValue([]);
	});

	it('passes each flag filter through as an equality condition', async () => {
		await listMembers({
			lookingForBand: true,
			availableForHire: true,
			teachesLessons: true,
			openToCollaboration: true
		});
		const conds = whereConditions(userFindMany);
		expect(conds).toContainEqual({ lookingForBand: true });
		expect(conds).toContainEqual({ availableForHire: true });
		expect(conds).toContainEqual({ teachesLessons: true });
		expect(conds).toContainEqual({ openToCollaboration: true });
	});

	it('omits flag conditions that are not set', async () => {
		await listMembers({ lookingForBand: true });
		const conds = whereConditions(userFindMany);
		expect(conds).toContainEqual({ lookingForBand: true });
		expect(conds).not.toContainEqual({ availableForHire: true });
		expect(conds).not.toContainEqual({ openToCollaboration: true });
	});

	it('turns a search term into a name LIKE condition', async () => {
		await listMembers({ search: 'jeff' });
		expect(whereConditions(userFindMany)).toContainEqual({ name: { like: '%jeff%' } });
	});
});

describe('band filters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		bandFindMany.mockResolvedValue([]);
	});

	it('passes lookingForMembers through and applies a name search', async () => {
		await listBands({ lookingForMembers: true, search: 'trio' });
		const conds = whereConditions(bandFindMany);
		expect(conds).toContainEqual({ lookingFor: 'members' });
		expect(conds).toContainEqual({ name: { like: '%trio%' } });
	});

	it('lists only entries attached to a band, and only live ones', async () => {
		// Three conditions doing three different jobs, and every one of them is a
		// way to leak. Without `groupId`, a member's entry — or in phase 10 an
		// unowned external act, which must never be listed anywhere — shows up on
		// the band page. Without `kind`, so does a club or committee. Without the
		// group's own `deletedAt`, a band deleted by any path other than
		// `deactivate()` keeps its listing.
		await listBands();
		const conds = whereConditions(bandFindMany);
		expect(conds).toContainEqual({ groupId: { isNotNull: true } });
		expect(conds).toContainEqual({ deletedAt: { isNull: true } });
		expect(conds).toContainEqual({ group: { kind: 'band', deletedAt: { isNull: true } } });
	});

	it('scopes a genre filter to genre tags', async () => {
		// Genres and instruments share one table now. A filter that forgot `kind`
		// would still return rows — a member who plays bass would answer a search
		// for the "bass" genre — so every it-works assertion would still pass.
		// This renders the fragment and looks for the predicate itself.
		await listBands({ genres: ['jazz'] });
		const raw = whereConditions(bandFindMany).find((c) => 'RAW' in c) as
			{ RAW: (t: unknown, o: unknown) => SQL } | undefined;
		expect(raw).toBeDefined();

		const rendered = new SQLiteSyncDialect().sqlToQuery(
			raw!.RAW({ id: sql`"directory_entry"."id"` }, {})
		);
		expect(rendered.sql).toContain('"directory_tag"."kind"');
		expect(rendered.params).toContain('genre');
		expect(rendered.params).toContain('jazz');
	});
});

describe('getPublicDirectory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a safe fallback (does not reject) when an underlying query throws', async () => {
		userFindMany.mockRejectedValue(new Error('D1 boom'));
		bandFindMany.mockResolvedValue([]);

		const result = await getPublicDirectory({});

		expect(result).toEqual({ members: [], bands: [], failed: true });
		expect(captureException).toHaveBeenCalledOnce();
	});

	it('returns members and bands with failed=false on success', async () => {
		userFindMany.mockResolvedValue([]);
		bandFindMany.mockResolvedValue([]);

		const result = await getPublicDirectory({});

		expect(result.members).toEqual([]);
		expect(result.bands).toEqual([]);
		expect(result.failed).toBe(false);
		expect(captureException).not.toHaveBeenCalled();
	});
});

describe('isProfileComplete', () => {
	const blank = { tagline: null, bio: null, image: null, instruments: [], genres: [] };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is false for a brand-new account with nothing filled in', async () => {
		userFindFirst.mockResolvedValue(blank);
		await expect(isProfileComplete('u1')).resolves.toBe(false);
	});

	it('is false when a missing user means there is no profile at all', async () => {
		userFindFirst.mockResolvedValue(undefined);
		await expect(isProfileComplete('nobody')).resolves.toBe(false);
	});

	it.each([
		['a tagline', { tagline: 'Bassist | Post-punk' }],
		['a bio', { bio: '<p>Moved here in 2025.</p>' }],
		['an avatar', { image: 'avatars/u1.png' }],
		['one instrument', { instruments: [{ instrument: 'bass' }] }],
		['one genre', { genres: [{ genre: 'post-punk' }] }]
	])('is true once the member has %s', async (_label, patch) => {
		userFindFirst.mockResolvedValue({ ...blank, ...patch });
		await expect(isProfileComplete('u1')).resolves.toBe(true);
	});

	it('treats whitespace-only text as still blank', async () => {
		userFindFirst.mockResolvedValue({ ...blank, tagline: '   ', bio: '\n\t' });
		await expect(isProfileComplete('u1')).resolves.toBe(false);
	});
});
