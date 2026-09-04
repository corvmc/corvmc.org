import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The public band profile must publish the press kit's marketing half and none
 * of its advance half.
 *
 * `press-kit.spec.ts` already proves `publicPressKit()` drops contacts. What it
 * cannot prove is that *this query calls it* — a `loadBandProfile` that returned
 * `site.epk` raw, or that put `directoryEntry.contact` back in its select, would
 * leave that spec green and publish a phone number. So this one drives the real
 * handler with the drizzle chain stubbed, and asserts on what actually comes
 * back.
 */

// A chainable stand-in for the drizzle builder: every method returns `this`, and
// awaiting it yields the next queued result. `loadBandProfile` issues four
// selects in a fixed order — the band row, its genres, its `band_site`, then its
// roster — so the queue is the whole of the fixture.
const { queue, dbSelect } = vi.hoisted(() => {
	const queue: unknown[][] = [];
	const chain: Record<string, unknown> = {};
	for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
		chain[m] = () => chain;
	}
	chain.then = (resolve: (v: unknown) => unknown) =>
		Promise.resolve(queue.shift() ?? []).then(resolve);
	return { queue, dbSelect: vi.fn(() => chain) };
});

vi.mock('$app/server', () => ({
	query: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: never[]) => unknown;
		(fn as { __?: unknown }).__ = { type: 'query' };
		return fn;
	},
	form: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: never[]) => unknown;
		(fn as { __?: unknown; for?: unknown }).__ = { type: 'form' };
		(fn as { for?: unknown }).for = () => fn;
		return fn;
	},
	getRequestEvent: () => ({ locals: {} })
}));
vi.mock('$lib/server/db', () => ({ db: { select: dbSelect, query: {} } }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string | null) => k }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'u1' }),
	requireStaff: vi.fn()
}));
vi.mock('$lib/server/group/group-context', () => ({ requireGroupRole: vi.fn() }));
vi.mock('$lib/server/media/media-service', () => ({
	listFor: vi.fn(async () => [
		{ attachmentId: 'att-1', key: 'bands/b1/media/image/x.jpg', altText: 'The act', caption: null }
	])
}));

// The profile also carries a band's releases now, and the flag that gates them
// reads site config out of KV — which no unit test has. Off is the right
// default here: this spec is about what the press kit does and does not
// publish, and a discography would only be noise in it.
vi.mock('$lib/server/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('$lib/server/audio/audio-service', () => ({
	listPublishedReleasesForBand: vi.fn(async () => [])
}));

import { getPublicBandProfile } from './directory.remote';

const BAND_ROW = {
	id: 'b1',
	entryId: 'e1',
	name: 'The Velvet Underground',
	slug: 'the-velvet-underground',
	bio: 'A band.',
	tagline: 'Loud',
	hometown: 'Corvallis',
	foundedYear: '1965',
	avatarKey: 'avatar.jpg',
	lookingFor: null,
	links: [],
	entryDeletedAt: null,
	directoryVisibility: 'public',
	memberCount: 3
};

/** Every private field carries a marker that appears nowhere else. */
const EPK = {
	bookingContact: { name: 'Booking Bea', email: 'bea@example.com', phone: '555-0100' },
	managementContact: { name: 'Manager Moe', email: 'moe@example.com' },
	prContact: { name: 'Press Pat', email: 'pat@example.com' },
	technicalRiderKey: 'media/rider-secret.pdf',
	stagePlotKey: 'media/stageplot-secret.png',
	backline: [{ instrument: 'Bass cab', details: 'Ampeg 8x10', provided: false }],
	pressQuotes: [{ quote: 'Loud and good', publication: 'The Gazette' }],
	achievements: ['Played the big room']
};

function seed(overrides: { epk?: unknown } = {}) {
	queue.length = 0;
	queue.push([BAND_ROW]);
	queue.push([{ value: 'rock' }]);
	queue.push([{ epk: 'epk' in overrides ? overrides.epk : EPK }]);
	queue.push([]);
}

beforeEach(() => {
	dbSelect.mockClear();
});

describe('getPublicBandProfile', () => {
	it('publishes the marketing half of the press kit', async () => {
		seed();
		const { band } = await getPublicBandProfile('the-velvet-underground');

		expect(band.pressKit.pressQuotes).toEqual([
			{ quote: 'Loud and good', publication: 'The Gazette' }
		]);
		expect(band.pressKit.achievements).toEqual(['Played the big room']);
		expect(band.photos).toEqual([
			{
				id: 'att-1',
				url: 'bands/b1/media/image/x.jpg',
				altText: 'The act',
				caption: null
			}
		]);
	});

	// The load-bearing assertion. Serialized and searched, so a field added to
	// `BandEpk` and forgotten in the projection fails here rather than shipping.
	it.each([
		'Booking Bea',
		'bea@example.com',
		'555-0100',
		'Manager Moe',
		'moe@example.com',
		'Press Pat',
		'pat@example.com',
		'rider-secret',
		'stageplot-secret',
		'Ampeg 8x10'
	])('never publishes %s', async (marker) => {
		seed();
		const profile = await getPublicBandProfile('the-velvet-underground');
		expect(JSON.stringify(profile)).not.toContain(marker);
	});

	it('publishes no contact field at all, under any name', async () => {
		seed();
		const { band } = await getPublicBandProfile('the-velvet-underground');
		// `directoryContact` was the field this page used to render as "Booking".
		expect('directoryContact' in band).toBe(false);
		expect(Object.keys(band)).not.toContain('contact');
	});

	it('survives a band that has written no press kit', async () => {
		seed({ epk: null });
		const { band } = await getPublicBandProfile('the-velvet-underground');
		expect(band.pressKit).toEqual({ pressQuotes: [], achievements: [], videos: [] });
	});
});
