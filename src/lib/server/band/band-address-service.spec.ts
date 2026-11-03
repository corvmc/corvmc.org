import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The address service decides who a slug belongs to, so its edge cases are the
 * ones that either break a band's public URL or hand it to someone else:
 * shadowing (a live slug always beats history), soft-deleted bands, and the
 * ordering inside the change batch.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Queued one result array per `db.select()` in the order the code runs them. */
let selectResults: unknown[][] = [];
/** Every predicate handed to `.where()`, so it can be rendered to real SQL below. */
const whereClauses: unknown[] = [];
/** Which write builders were constructed, in order — the batch's contents. */
let writeCalls: string[] = [];
let batchError: Error | null = null;

function chainableSelect() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResults.shift() ?? []);
			}
			if (prop === 'where') {
				return (clause: unknown) => {
					whereClauses.push(clause);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

// Hoisted: the module factories below run before top-level consts initialize.
const { forgetCustomDomain, BandNotFoundError } = vi.hoisted(() => ({
	forgetCustomDomain: vi.fn(async () => {}),
	BandNotFoundError: class BandNotFoundError extends Error {
		constructor() {
			super('Band not found');
			this.name = 'BandNotFoundError';
		}
	}
}));

vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: vi.fn(() => chainableSelect()),
		delete: vi.fn(() => {
			writeCalls.push('delete');
			return { where: vi.fn(() => ({ op: 'delete' })) };
		}),
		insert: vi.fn(() => {
			writeCalls.push('insert');
			return {
				values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(() => ({ op: 'insert' })) }))
			};
		}),
		update: vi.fn(() => {
			writeCalls.push('update');
			return { set: vi.fn(() => ({ where: vi.fn(() => ({ op: 'update' })) })) };
		}),
		batch: vi.fn(async () => {
			if (batchError) throw batchError;
			return [];
		})
	}
}));

vi.mock('#lib/server/band/band-host-service.js', () => ({ forgetCustomDomain }));

vi.mock('#lib/server/band/band-service.js', () => ({ BandNotFoundError }));

import {
	MAX_BAND_SLUG_LENGTH,
	SlugUnavailableError,
	assertValidBandSlug,
	changeBandSlug,
	normalizeBandSlug,
	resolveBandSlug
} from './band-address-service';
import { db } from '#lib/server/db/index.js';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// drizzle and the schema are real, so the predicates the service builds can be
// rendered to actual SQL and asserted on rather than taken on faith.
const dialect = new SQLiteSyncDialect();
const renderWhere = (index: number) => dialect.sqlToQuery(whereClauses[index] as SQL).sql;

const bandRow = { id: 'band-1', slug: 'the-neons', customDomain: null as string | null };

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	whereClauses.length = 0;
	writeCalls = [];
	batchError = null;
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('normalizeBandSlug', () => {
	// Spaces collapse rather than hyphenating: someone typing an address is
	// choosing a domain, not naming a band.
	it('drops spaces and punctuation instead of hyphenating them', () => {
		expect(normalizeBandSlug('The Neons!!')).toBe('theneons');
		expect(normalizeBandSlug('  Sœur   Sonic  ')).toBe('sursonic');
	});

	it('keeps hyphens the owner typed on purpose', () => {
		expect(normalizeBandSlug('The-Neons')).toBe('the-neons');
		expect(normalizeBandSlug('--the -- neons--')).toBe('the-neons');
	});
});

describe('assertValidBandSlug', () => {
	it('rejects a value that normalizes to nothing', () => {
		expect(() => assertValidBandSlug('')).toThrow(SlugUnavailableError);
	});

	it('rejects anything longer than a DNS label', () => {
		expect(() => assertValidBandSlug('a'.repeat(MAX_BAND_SLUG_LENGTH + 1))).toThrow(
			SlugUnavailableError
		);
		expect(() => assertValidBandSlug('a'.repeat(MAX_BAND_SLUG_LENGTH))).not.toThrow();
	});

	it('rejects reserved slugs, which would be unreachable as a subdomain', () => {
		expect(() => assertValidBandSlug('admin')).toThrow(SlugUnavailableError);
		// Cloudflare for SaaS plumbing — claiming it would break every custom domain.
		expect(() => assertValidBandSlug('saas')).toThrow(SlugUnavailableError);
	});
});

// ---------------------------------------------------------------------------
// resolveBandSlug
// ---------------------------------------------------------------------------

describe('resolveBandSlug', () => {
	it('answers from the live band without consulting history', async () => {
		selectResults = [[{ slug: 'the-neons' }]];

		await expect(resolveBandSlug('the-neons')).resolves.toEqual({
			kind: 'current',
			slug: 'the-neons'
		});
		expect(db.select).toHaveBeenCalledTimes(1);
	});

	it('lets a soft-deleted band shadow history, but never redirect into one', async () => {
		selectResults = [[], []];

		await resolveBandSlug('the-neon-boys');

		// The live-slug check must NOT filter deletedAt: a soft-deleted band still
		// occupies the unique index, so its address stays taken.
		expect(renderWhere(0)).not.toContain('deleted_at');
		// The history join must, or an old address would redirect into a band that
		// no longer exists.
		expect(renderWhere(1)).toContain('"deleted_at" is null');
	});

	it('returns the band’s current slug for a released one', async () => {
		selectResults = [[], [{ slug: 'the-neons' }]];

		await expect(resolveBandSlug('the-neon-boys')).resolves.toEqual({
			kind: 'moved',
			slug: 'the-neons'
		});
	});

	it('returns null when nothing holds the slug', async () => {
		selectResults = [[], []];

		await expect(resolveBandSlug('nobody')).resolves.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// changeBandSlug
// ---------------------------------------------------------------------------

describe('changeBandSlug', () => {
	it('throws when the band is gone', async () => {
		selectResults = [[]];

		await expect(changeBandSlug('band-1', 'whatever')).rejects.toThrow(BandNotFoundError);
	});

	it('is a no-op when the address is unchanged', async () => {
		selectResults = [[bandRow]];

		await expect(changeBandSlug('band-1', 'The-Neons')).resolves.toEqual({
			status: 'unchanged',
			slug: 'the-neons',
			previousSlug: 'the-neons'
		});
		expect(db.batch).not.toHaveBeenCalled();
	});

	it('refuses an address another band currently holds', async () => {
		selectResults = [[bandRow], [{ id: 'band-2' }]];

		await expect(changeBandSlug('band-1', 'The Sonics')).rejects.toThrow(SlugUnavailableError);
		expect(db.batch).not.toHaveBeenCalled();
	});

	it('claims the new address, then records the old one, in one batch', async () => {
		selectResults = [[bandRow], []];

		await expect(changeBandSlug('band-1', 'The Neon Boys')).resolves.toEqual({
			status: 'changed',
			slug: 'theneonboys',
			previousSlug: 'the-neons'
		});

		expect(db.batch).toHaveBeenCalledTimes(1);
		// Clearing a stale history row for the claimed slug has to precede
		// recording the released one, or the two writes contradict each other.
		expect(writeCalls).toEqual(['delete', 'insert', 'update']);
	});

	it('remaps a lost race on the unique index to a usable message', async () => {
		selectResults = [[bandRow], []];
		batchError = new Error('D1_ERROR: UNIQUE constraint failed: band.slug');

		await expect(changeBandSlug('band-1', 'the-neon-boys')).rejects.toThrow(SlugUnavailableError);
	});

	it('rethrows anything that is not a collision', async () => {
		selectResults = [[bandRow], []];
		batchError = new Error('D1_ERROR: network');

		await expect(changeBandSlug('band-1', 'the-neon-boys')).rejects.toThrow('D1_ERROR: network');
	});

	it('purges the host cache when the band has a custom domain', async () => {
		selectResults = [[{ ...bandRow, customDomain: 'theneons.com' }], []];

		await changeBandSlug('band-1', 'the-neon-boys');

		expect(forgetCustomDomain).toHaveBeenCalledWith('theneons.com');
	});

	it('skips the purge when there is no custom domain', async () => {
		selectResults = [[bandRow], []];

		await changeBandSlug('band-1', 'the-neon-boys');

		expect(forgetCustomDomain).not.toHaveBeenCalled();
	});
});
