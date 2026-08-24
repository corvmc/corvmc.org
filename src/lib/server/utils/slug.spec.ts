import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture each WHERE condition and feed back scripted collision counts so the
// suffix loop runs without a DB.
const { whereConditions, collisionCounts } = vi.hoisted(() => ({
	whereConditions: [] as unknown[],
	collisionCounts: [] as number[]
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: (cond: unknown) => {
					whereConditions.push(cond);
					return Promise.resolve([{ count: collisionCounts.shift() ?? 0 }]);
				}
			})
		})
	}
}));

import { generateSlug, ensureUniqueSlug } from './slug';

const fakeTable = {} as never;
const slugColumn = { name: 'slug' } as never;
const idColumn = { name: 'id' } as never;

beforeEach(() => {
	whereConditions.length = 0;
	collisionCounts.length = 0;
});

describe('generateSlug', () => {
	it('lowercases and collapses everything that is not a letter, digit or hyphen', () => {
		expect(generateSlug('The Velvet Underground')).toBe('thevelvetunderground');
		expect(generateSlug('  A -- B!! ')).toBe('a-b');
	});

	// Slug generation never introduces a hyphen of its own — spaces collapse,
	// and only hyphens already present in the name survive.
	it('strips special characters without leaving a hyphen behind', () => {
		expect(generateSlug('Rock & Roll!!!')).toBe('rockroll');
		expect(generateSlug("The Band's Name (Official)")).toBe('thebandsnameofficial');
	});

	it('keeps hyphens that were already in the name', () => {
		expect(generateSlug('Sun-Ra Arkestra')).toBe('sun-raarkestra');
	});

	it('collapses consecutive hyphens and trims them from the ends', () => {
		expect(generateSlug('a---b')).toBe('a-b');
		expect(generateSlug('---hello---')).toBe('hello');
	});

	it('passes through a single lowercase word and the empty string', () => {
		expect(generateSlug('Radiohead')).toBe('radiohead');
		expect(generateSlug('')).toBe('');
	});

	// Documents the input that `ensureUniqueSlug` has to defend against: the
	// regex keeps only [a-z0-9-], so a name written in any non-Latin script — or
	// made entirely of punctuation or emoji — slugifies to the empty string.
	it('yields an empty string for names with no ASCII alphanumerics', () => {
		expect(generateSlug('東京事変')).toBe('');
		expect(generateSlug('☆')).toBe('');
		expect(generateSlug('!!!')).toBe('');
	});
});

describe('ensureUniqueSlug', () => {
	it('returns the base slug when unused', async () => {
		collisionCounts.push(0);
		expect(await ensureUniqueSlug('my-band', fakeTable, slugColumn)).toBe('my-band');
	});

	it('appends -2 when the base slug is taken', async () => {
		collisionCounts.push(1, 0);
		expect(await ensureUniqueSlug('my-band', fakeTable, slugColumn)).toBe('my-band-2');
	});

	it('appends -2, -3 until free', async () => {
		collisionCounts.push(1, 1, 0);
		expect(await ensureUniqueSlug('my-band', fakeTable, slugColumn)).toBe('my-band-3');
	});

	it('excludes the given row from the collision check', async () => {
		// Regression: band-service.update re-slugs on every save; without the
		// exclusion the band's own row counted as a collision and each save
		// rotated the slug (my-band → my-band-2 → …), breaking inbound links.
		collisionCounts.push(0);
		const slug = await ensureUniqueSlug('my-band', fakeTable, slugColumn, {
			column: idColumn,
			value: 'band-1'
		});
		expect(slug).toBe('my-band');

		const cond = JSON.stringify(whereConditions[0]);
		expect(cond).toContain(' and ');
		expect(cond).toContain('band-1');
	});

	it('omits the exclusion clause when no exclude is given', async () => {
		collisionCounts.push(0);
		await ensureUniqueSlug('my-band', fakeTable, slugColumn);
		expect(JSON.stringify(whereConditions[0])).not.toContain(' and ');
	});

	// Regression: an empty base slug was stored verbatim. It isn't NULL, so the
	// insert succeeded and the row was permanently unreachable — /band/ 404s, the
	// {slug}.corvmc.org reroute breaks, and the create modal's `if (result?.slug)`
	// redirect silently never fires because '' is falsy. A second such row got the
	// slug '-2'.
	it('substitutes a fallback when the base slug is empty', async () => {
		collisionCounts.push(0);
		expect(await ensureUniqueSlug('', fakeTable, slugColumn)).toBe('untitled');
	});

	it('suffixes the fallback rather than producing a bare -2', async () => {
		collisionCounts.push(1, 0);
		expect(await ensureUniqueSlug('', fakeTable, slugColumn)).toBe('untitled-2');
	});
});
