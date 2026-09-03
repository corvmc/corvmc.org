/**
 * `findMatchesFor` against real SQLite, on the real migrated tables.
 *
 * `directory-service.spec.ts` asserts the *shape* of the filter tree — which is
 * where the exclusions live and where a mistake is a trust bug — but it never
 * asks SQLite whether that tree is a query. Three things in this one cannot be
 * checked any other way:
 *
 *  - the block filter is a `RAW` fragment that interpolates an **outer column**
 *    into a correlated `NOT EXISTS`, so it is only valid if drizzle renders
 *    `table.userId` as an identifier rather than binding it;
 *  - the overlap filter is an `OR` of two `RAW`s **nested inside** the `AND`
 *    that carries the listing gates;
 *  - `{ groupId: { notIn: [...] } }` has to survive alongside both.
 *
 * Each of those would pass a mocked test and fail on the first real request.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import * as schema from '$lib/server/db/schema';
import { relations } from '$lib/server/db/schema/relations';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');

let sqlite: DatabaseSync;

// The real drizzle instance, over a real database, in place of the D1 binding.
// Everything else the service touches is either pure or stubbed below.
const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }));
vi.mock('$lib/server/db', () => ({
	get db() {
		return dbRef.current;
	}
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string | null) => k }));

const { findMatchesFor } = await import('./directory-service');

function seed(sql: string) {
	sqlite.exec(sql);
}

beforeAll(() => {
	sqlite = new DatabaseSync(':memory:');
	migrate(drizzle({ client: sqlite }), { migrationsFolder: MIGRATIONS_FOLDER });
	dbRef.current = drizzle({ client: sqlite, schema, relations });

	// Four members and three bands, arranged so every exclusion has something to
	// exclude and the ranking has all three tiers to order.
	seed(`
		INSERT INTO user (id, name, email, email_verified) VALUES
			('u-seeker',  'Ada Vogel',      'ada@example.com',    1),
			('u-leader',  'Marisol Trent',  'mari@example.com',   1),
			('u-drummer', 'Jo Fields',      'jo@example.com',     1),
			('u-blocked', 'Sam Reyes',      'sam@example.com',    1),
			('u-gone',    'Deactivated',    'gone@example.com',   1);

		UPDATE user SET deleted_at = unixepoch() WHERE id = 'u-gone';

		INSERT INTO "group" (id, kind, name, slug) VALUES
			('g-match',  'band', 'The Overlap',   'the-overlap'),
			('g-mine',   'band', 'My Own Band',   'my-own-band'),
			('g-genre',  'band', 'Genre Only',    'genre-only'),
			('g-hidden', 'band', 'Hidden Band',   'hidden-band');

		-- The seeker is in one of them, which is the exclusion that matters most.
		INSERT INTO group_member (id, group_id, user_id, role, status) VALUES
			('gm-1', 'g-mine', 'u-seeker', 'owner', 'active');

		INSERT INTO directory_entry (id, user_id, name, looking_for, visibility) VALUES
			('e-seeker',  'u-seeker',  'Ada Vogel',     'band',    'members'),
			('e-leader',  'u-leader',  'Marisol Trent', 'members', 'members'),
			('e-drummer', 'u-drummer', 'Jo Fields',     'band',    'members'),
			('e-blocked', 'u-blocked', 'Sam Reyes',     'band',    'members'),
			('e-gone',    'u-gone',    'Deactivated',   'band',    'members');

		INSERT INTO directory_entry (id, group_id, name, looking_for, visibility) VALUES
			('e-match',  'g-match',  'The Overlap', 'members', 'public'),
			('e-mine',   'g-mine',   'My Own Band', 'members', 'public'),
			('e-genre',  'g-genre',  'Genre Only',  'members', 'public'),
			('e-hidden', 'g-hidden', 'Hidden Band', 'members', 'hidden');

		INSERT INTO directory_tag (entry_id, kind, value) VALUES
			('e-seeker',  'instrument', 'bass'),
			('e-seeker',  'genre',      'jazz'),

			('e-leader',  'seeking_instrument', 'drums'),
			('e-leader',  'genre',              'punk'),

			-- Two members who play drums and want a band; one of them is blocked.
			('e-drummer', 'instrument', 'drums'),
			('e-drummer', 'genre',      'punk'),
			('e-blocked', 'instrument', 'drums'),
			('e-blocked', 'genre',      'punk'),
			('e-gone',    'instrument', 'drums'),
			('e-gone',    'genre',      'punk'),

			-- Instrument AND genre, so this one ranks first.
			('e-match',  'seeking_instrument', 'bass'),
			('e-match',  'genre',              'jazz'),
			-- Genre only, so it ranks last.
			('e-genre',  'seeking_instrument', 'tuba'),
			('e-genre',  'genre',              'jazz'),
			-- The seeker's own band, a perfect match on paper.
			('e-mine',   'seeking_instrument', 'bass'),
			('e-mine',   'genre',              'jazz'),
			-- Opted out of the directory entirely.
			('e-hidden', 'seeking_instrument', 'bass'),
			('e-hidden', 'genre',              'jazz');

		INSERT INTO user_block (id, blocker_user_id, blocked_user_id) VALUES
			('b-1', 'u-blocked', 'u-leader');
	`);
}, 30_000);

afterAll(() => sqlite?.close());

describe('findMatchesFor, against SQLite', () => {
	it('ranks bands, skips the viewer’s own, and skips the ones that opted out', async () => {
		const { direction, gaps, matches } = await findMatchesFor('u-seeker');

		expect(direction).toBe('band');
		expect(gaps).toEqual([]);
		// `g-mine` is the viewer's own band and `g-hidden` opted out — both would
		// otherwise outrank `Genre Only`, so their absence is not an accident of
		// ordering.
		expect(matches.map((m) => m.ref.title)).toEqual(['The Overlap', 'Genre Only']);
		expect(matches[0]).toMatchObject({
			sharedInstruments: ['bass'],
			sharedGenres: ['jazz'],
			ref: { type: 'band', id: 'g-match', slug: 'the-overlap' }
		});
		expect(matches[1].sharedInstruments).toEqual([]);
	});

	it('matches the other direction, and honours a block written the other way round', async () => {
		// `u-blocked` blocked the viewer, not the reverse — one row is enough
		// because every check reads both ways. `u-gone` is deactivated.
		const { direction, matches } = await findMatchesFor('u-leader');

		expect(direction).toBe('members');
		expect(matches.map((m) => m.ref.id)).toEqual(['u-drummer']);
	});

	it('answers for an account the directory has never seen, rather than throwing', async () => {
		// `findFirst` returns undefined and every branch below has to cope: no
		// entry is the state a brand-new account is in for one request, before
		// `ensureUserEntry` runs.
		await expect(findMatchesFor('nobody')).resolves.toEqual({
			direction: null,
			gaps: ['lookingFor', 'instruments', 'genres'],
			matches: []
		});
	});
});
