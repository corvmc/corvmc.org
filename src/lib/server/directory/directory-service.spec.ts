import { describe, it, expect, vi, beforeEach } from 'vitest';

// getPublicDirectory aggregates listPublicMembers + listPublicBands, which hit
// D1 via `db.query.*.findMany` and R2 via resolveImageUrl. Mock at those
// boundaries so the real aggregation/try-catch runs without a DB or storage.
const { entryFindMany, entryFindFirst, captureException, selectRows } = vi.hoisted(() => ({
	entryFindMany: vi.fn(),
	entryFindFirst: vi.fn(),
	captureException: vi.fn(),
	/** What the one `db.select()` in this file — the viewer's own bands — returns. */
	selectRows: vi.fn(() => [] as unknown[])
}));

// Members and bands both read `directory_entry` since phase 3a — one table, one
// mock, and the halves differ only in whether the entry is attached to a user or
// a group. The `where` assertions below are what tell them apart.
vi.mock('$lib/server/db', () => ({
	db: {
		query: {
			directoryEntry: { findMany: entryFindMany, findFirst: entryFindFirst }
		},
		// `findMatchesFor` reads the viewer's own group memberships through the
		// builder rather than the relational API. One chainable stub, resolving to
		// whatever `selectRows` is set to.
		select: () => {
			const chain: Record<string, unknown> = {};
			for (const method of ['from', 'where', 'innerJoin', 'leftJoin', 'limit', 'orderBy']) {
				chain[method] = () => chain;
			}
			chain.then = (resolve: (v: unknown) => void) => resolve(selectRows());
			return chain;
		}
	}
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string | null) => k }));
vi.mock('$lib/server/sentry', () => ({ captureException }));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { sql, type SQL } from 'drizzle-orm';
import {
	getPublicDirectory,
	listMembers,
	listBands,
	isProfileComplete,
	findMatchesFor
} from './directory-service';

/** Pull the `AND` condition array out of the `where` passed to a findMany mock. */
function whereConditions(mock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
	const arg = mock.mock.calls[0]?.[0] as { where?: { AND?: Record<string, unknown>[] } };
	return arg?.where?.AND ?? [];
}

describe('member filters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		entryFindMany.mockResolvedValue([]);
	});

	it('passes each flag filter through as an equality condition', async () => {
		await listMembers({
			lookingForBand: true,
			availableForHire: true,
			teachesLessons: true,
			openToCollaboration: true
		});
		const conds = whereConditions(entryFindMany);
		// `lookingForBand` became one end of a two-way column; the other three
		// kept the shape they had on `user`.
		expect(conds).toContainEqual({ lookingFor: 'band' });
		expect(conds).toContainEqual({ availableForHire: true });
		expect(conds).toContainEqual({ teachesLessons: true });
		expect(conds).toContainEqual({ openToCollaboration: true });
	});

	it('lists only entries attached to a member, and only live ones', async () => {
		// The mirror of the band assertion, and the same three leaks: without
		// `userId` a band's listing appears among the musicians, and in phase 10
		// so does an unowned external act. `user.deletedAt` is the flag that
		// matters here — `purgeUser` and `deactivateUser` set the user's, not the
		// entry's.
		await listMembers();
		const conds = whereConditions(entryFindMany);
		expect(conds).toContainEqual({ userId: { isNotNull: true } });
		expect(conds).toContainEqual({ deletedAt: { isNull: true } });
		expect(conds).toContainEqual({ user: { deletedAt: { isNull: true } } });
	});

	it('scopes an instrument filter to instrument tags', async () => {
		// The failure this catches is quiet: without `kind` the same table
		// answers with genres, so a search for members who play "jazz" would
		// return everyone who lists jazz as a genre and the filter would look
		// like it worked.
		await listMembers({ instruments: ['bass'] });
		const raw = whereConditions(entryFindMany).find((c) => 'RAW' in c) as
			{ RAW: (t: unknown, o: unknown) => SQL } | undefined;
		expect(raw).toBeDefined();

		const rendered = new SQLiteSyncDialect().sqlToQuery(
			raw!.RAW({ id: sql`"directory_entry"."id"` }, {})
		);
		expect(rendered.sql).toContain('"directory_tag"."kind"');
		expect(rendered.params).toContain('instrument');
		expect(rendered.params).toContain('bass');
	});

	it('omits flag conditions that are not set', async () => {
		await listMembers({ lookingForBand: true });
		const conds = whereConditions(entryFindMany);
		expect(conds).toContainEqual({ lookingFor: 'band' });
		expect(conds).not.toContainEqual({ availableForHire: true });
		expect(conds).not.toContainEqual({ openToCollaboration: true });
	});

	it('turns a search term into a name LIKE condition', async () => {
		await listMembers({ search: 'jeff' });
		expect(whereConditions(entryFindMany)).toContainEqual({ name: { like: '%jeff%' } });
	});
});

describe('band filters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		entryFindMany.mockResolvedValue([]);
	});

	it('passes lookingForMembers through and applies a name search', async () => {
		await listBands({ lookingForMembers: true, search: 'trio' });
		const conds = whereConditions(entryFindMany);
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
		const conds = whereConditions(entryFindMany);
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
		const raw = whereConditions(entryFindMany).find((c) => 'RAW' in c) as
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
		// One mock now backs both halves, so a single rejection is the whole
		// failure case — `getPublicDirectory` runs them with Promise.all.
		entryFindMany.mockRejectedValue(new Error('D1 boom'));

		const result = await getPublicDirectory({});

		expect(result).toEqual({ members: [], bands: [], failed: true });
		expect(captureException).toHaveBeenCalledOnce();
	});

	it('returns members and bands with failed=false on success', async () => {
		entryFindMany.mockResolvedValue([]);

		const result = await getPublicDirectory({});

		expect(result.members).toEqual([]);
		expect(result.bands).toEqual([]);
		expect(result.failed).toBe(false);
		expect(captureException).not.toHaveBeenCalled();
	});
});

describe('isProfileComplete', () => {
	const blank = { tagline: null, bio: null, user: { image: null }, tags: [] };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is false for a brand-new account with nothing filled in', async () => {
		entryFindFirst.mockResolvedValue(blank);
		await expect(isProfileComplete('u1')).resolves.toBe(false);
	});

	it('is false when a missing user means there is no profile at all', async () => {
		entryFindFirst.mockResolvedValue(undefined);
		await expect(isProfileComplete('nobody')).resolves.toBe(false);
	});

	it.each([
		['a tagline', { tagline: 'Bassist | Post-punk' }],
		['a bio', { bio: '<p>Moved here in 2025.</p>' }],
		['an avatar', { user: { image: 'avatars/u1.png' } }],
		['one tag of any kind', { tags: [{ kind: 'instrument' }] }]
	])('is true once the member has %s', async (_label, patch) => {
		entryFindFirst.mockResolvedValue({ ...blank, ...patch });
		await expect(isProfileComplete('u1')).resolves.toBe(true);
	});

	it('treats whitespace-only text as still blank', async () => {
		entryFindFirst.mockResolvedValue({ ...blank, tagline: '   ', bio: '\n\t' });
		await expect(isProfileComplete('u1')).resolves.toBe(false);
	});
});

// ---------------------------------------------------------------------------
// findMatchesFor
// ---------------------------------------------------------------------------

/** Every condition in a nested `{ AND: [...] }` tree, flattened. */
function flatConditions(where: unknown): Record<string, unknown>[] {
	const node = where as { AND?: unknown[] } | undefined;
	if (!node) return [];
	if (Array.isArray(node.AND)) return node.AND.flatMap(flatConditions);
	return [node as Record<string, unknown>];
}

function matchWhere() {
	return flatConditions(
		(entryFindMany.mock.calls[0]?.[0] as { where?: unknown } | undefined)?.where
	);
}

/** Render a `RAW` condition to SQL so the predicate itself can be asserted on. */
function renderRaw(cond: Record<string, unknown>) {
	const raw = cond.RAW as (t: unknown, o: unknown) => SQL;
	return new SQLiteSyncDialect().sqlToQuery(
		raw({ id: sql`"directory_entry"."id"`, userId: sql`"directory_entry"."user_id"` }, {})
	);
}

/** Every `RAW` in the flattened tree, including the ones nested under an `OR`. */
function allRaw(conds: Record<string, unknown>[]): Record<string, unknown>[] {
	return conds.flatMap((c) => {
		if ('RAW' in c) return [c];
		if (Array.isArray((c as { OR?: unknown[] }).OR)) {
			return (c as { OR: Record<string, unknown>[] }).OR.filter((o) => 'RAW' in o);
		}
		return [];
	});
}

const viewer = (lookingFor: string | null, tags: { kind: string; value: string }[]) => ({
	lookingFor,
	tags
});

describe('findMatchesFor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		entryFindMany.mockResolvedValue([]);
		selectRows.mockReturnValue([]);
	});

	it('asks nothing at all when the viewer has not said what they are looking for', async () => {
		// The direction is the viewer's own, so with no answer there is no
		// question. Naming the gap is the card's whole job in this state.
		entryFindFirst.mockResolvedValue(
			viewer(null, [
				{ kind: 'instrument', value: 'bass' },
				{ kind: 'genre', value: 'jazz' }
			])
		);

		const result = await findMatchesFor('u1');

		expect(result).toEqual({ direction: null, gaps: ['lookingFor'], matches: [] });
		expect(entryFindMany).not.toHaveBeenCalled();
	});

	it('names every missing field, and asks nothing, when there is nothing to intersect', async () => {
		entryFindFirst.mockResolvedValue(viewer('band', []));

		const result = await findMatchesFor('u1');

		expect(result.gaps).toEqual(['instruments', 'genres']);
		expect(entryFindMany).not.toHaveBeenCalled();
	});

	it('asks a member who wants members for the instruments they need, not the ones they play', async () => {
		// The two directions read different tag kinds off the *viewer*, and
		// swapping them is the quiet failure: a bandleader would be matched on
		// what they personally play.
		entryFindFirst.mockResolvedValue(
			viewer('members', [
				{ kind: 'instrument', value: 'guitar' },
				{ kind: 'seeking_instrument', value: 'drums' },
				{ kind: 'genre', value: 'punk' }
			])
		);

		await findMatchesFor('u1');

		const rendered = allRaw(matchWhere()).map((c) => renderRaw(c));
		const tagFilter = rendered.find((r) => r.sql.includes('"directory_tag"'))!;
		expect(tagFilter.params).toContain('drums');
		expect(tagFilter.params).not.toContain('guitar');
	});

	describe('a member looking for a band', () => {
		beforeEach(() => {
			entryFindFirst.mockResolvedValue(
				viewer('band', [
					{ kind: 'instrument', value: 'bass' },
					{ kind: 'genre', value: 'jazz' }
				])
			);
		});

		it('looks for bands that want members, on the listing gates bands always carry', async () => {
			await findMatchesFor('u1');
			const conds = matchWhere();

			expect(conds).toContainEqual({ lookingFor: 'members' });
			// Reused from `bandWhereConditions`, not restated — a match must
			// withhold everything a listing withholds.
			expect(conds).toContainEqual({ groupId: { isNotNull: true } });
			expect(conds).toContainEqual({ deletedAt: { isNull: true } });
			expect(conds).toContainEqual({ group: { kind: 'band', deletedAt: { isNull: true } } });
			expect(conds).toContainEqual({ visibility: { in: ['members', 'public'] } });
		});

		it('matches the viewer’s instruments against what the band is short of', async () => {
			await findMatchesFor('u1');

			const rendered = allRaw(matchWhere()).map((c) => renderRaw(c));
			// Scoped to `seeking_instrument`: unscoped, a band whose *genre* is
			// "bass" would answer, and the filter would look like it worked.
			expect(rendered.some((r) => r.params.includes('seeking_instrument'))).toBe(true);
			expect(rendered.some((r) => r.params.includes('bass'))).toBe(true);
		});

		it('excludes the bands the viewer is already in', async () => {
			// A trust bug rather than a bad suggestion: being told to go meet your
			// own band is the loudest way for this card to say it does not know you.
			selectRows.mockReturnValue([{ groupId: 'band-mine' }, { groupId: 'band-also-mine' }]);

			await findMatchesFor('u1');

			expect(matchWhere()).toContainEqual({
				groupId: { notIn: ['band-mine', 'band-also-mine'] }
			});
		});

		it('omits the exclusion rather than emitting an empty NOT IN', async () => {
			selectRows.mockReturnValue([]);
			await findMatchesFor('u1');
			expect(matchWhere().some((c) => 'groupId' in c && 'notIn' in (c.groupId as object))).toBe(
				false
			);
		});
	});

	describe('a member looking for members', () => {
		beforeEach(() => {
			entryFindFirst.mockResolvedValue(
				viewer('members', [
					{ kind: 'seeking_instrument', value: 'drums' },
					{ kind: 'genre', value: 'punk' }
				])
			);
		});

		it('looks for members who want a band, on the gates the member listing carries', async () => {
			await findMatchesFor('u1');
			const conds = matchWhere();

			expect(conds).toContainEqual({ lookingFor: 'band' });
			expect(conds).toContainEqual({ userId: { isNotNull: true } });
			// The deactivated-account flag, which is the user's rather than the
			// entry's — `deactivateUser` sets that one.
			expect(conds).toContainEqual({ user: { deletedAt: { isNull: true } } });
			expect(conds).toContainEqual({ deletedAt: { isNull: true } });
		});

		it('never matches the viewer to themselves', async () => {
			await findMatchesFor('u1');
			expect(matchWhere()).toContainEqual({ userId: { ne: 'u1' } });
		});

		it('excludes anyone on either side of a block', async () => {
			// The other trust bug. DMs already refuse to open a conversation across
			// a block, so a match that ignored it would be a way around it — and
			// the block is checked in BOTH directions, since one row is enough.
			await findMatchesFor('u1');

			const blockFilter = allRaw(matchWhere())
				.map((c) => renderRaw(c))
				.find((r) => r.sql.includes('user_block'));

			expect(blockFilter).toBeDefined();
			expect(blockFilter!.sql).toContain('NOT EXISTS');
			expect(blockFilter!.sql).toContain('blocker_user_id');
			expect(blockFilter!.sql).toContain('blocked_user_id');
			// Both directions, so the viewer's id is bound twice.
			expect(blockFilter!.params.filter((p) => p === 'u1')).toHaveLength(2);
		});
	});

	describe('ranking', () => {
		beforeEach(() => {
			entryFindFirst.mockResolvedValue(
				viewer('band', [
					{ kind: 'instrument', value: 'bass' },
					{ kind: 'genre', value: 'jazz' }
				])
			);
		});

		it('puts instrument and genre first, then instrument, then genre', async () => {
			// Alphabetical order in the fixture is the reverse of the expected
			// output, so a result that merely kept the query's `ORDER BY name`
			// would fail this.
			entryFindMany.mockResolvedValue([
				{
					groupId: 'b-genre',
					name: 'A Genre Only',
					tagline: null,
					group: { slug: 'genre-only', avatarKey: null },
					tags: [{ kind: 'genre', value: 'jazz' }]
				},
				{
					groupId: 'b-instrument',
					name: 'B Instrument Only',
					tagline: null,
					group: { slug: 'instrument-only', avatarKey: null },
					tags: [{ kind: 'seeking_instrument', value: 'bass' }]
				},
				{
					groupId: 'b-both',
					name: 'C Both',
					tagline: null,
					group: { slug: 'both', avatarKey: null },
					tags: [
						{ kind: 'seeking_instrument', value: 'bass' },
						{ kind: 'genre', value: 'jazz' }
					]
				}
			]);

			const { matches } = await findMatchesFor('u1');

			expect(matches.map((m) => m.ref.id)).toEqual(['b-both', 'b-instrument', 'b-genre']);
		});

		it('reports the overlap that produced each suggestion', async () => {
			entryFindMany.mockResolvedValue([
				{
					groupId: 'b1',
					name: 'The Overlap',
					tagline: 'Funk quartet',
					group: { slug: 'the-overlap', avatarKey: 'bands/b1.png' },
					tags: [
						{ kind: 'seeking_instrument', value: 'bass' },
						// Not the viewer's — a tag the band carries that nothing matched.
						{ kind: 'seeking_instrument', value: 'trumpet' },
						{ kind: 'genre', value: 'jazz' }
					]
				}
			]);

			const { matches } = await findMatchesFor('u1');

			expect(matches[0].sharedInstruments).toEqual(['bass']);
			expect(matches[0].sharedGenres).toEqual(['jazz']);
			// The BAND's id and slug, and its own avatar — not the entry's.
			expect(matches[0].ref).toMatchObject({
				type: 'band',
				id: 'b1',
				slug: 'the-overlap',
				title: 'The Overlap',
				subtitle: 'Funk quartet',
				image: 'bands/b1.png'
			});
		});
	});
});
