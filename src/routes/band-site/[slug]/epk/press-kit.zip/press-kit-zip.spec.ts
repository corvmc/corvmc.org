import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

/**
 * The public press kit download. It has no session to check, so the only
 * things standing between a stranger and a band's kit are the premium-site
 * condition and the public projection. Both are driven through the real
 * handler with the drizzle chain stubbed, and the assertions read the zip.
 */

const { selectResult } = vi.hoisted(() => ({ selectResult: { rows: [] as unknown[] } }));

vi.mock('#lib/server/db/index.js', () => {
	const chain: Record<string, unknown> = {};
	for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'limit']) chain[m] = () => chain;
	chain.then = (resolve: (v: unknown) => unknown) =>
		Promise.resolve(selectResult.rows).then(resolve);
	return { db: { select: () => chain } };
});
vi.mock('$app/env/public', async () =>
	(await import('#lib/testing/env-mock.js')).envMock({ PUBLIC_SITE_URL: 'https://corvmc.test' })
);

const getObject = vi.fn(async (_key: string) => ({
	bytes: new Uint8Array([0xff, 0xd8, 0xff]),
	contentType: 'image/jpeg'
}));
vi.mock('#lib/server/storage.js', () => ({
	getObject: (key: string) => getObject(key),
	resolveImageUrl: (k: string | null) => k
}));
vi.mock('#lib/server/media/media-service.js', () => ({
	listFor: vi.fn(async () => [{ key: 'bands/b1/media/image/one.jpg', slot: 'gallery' }])
}));
vi.mock('#lib/server/band/band-site-content.js', () => ({
	loadBandSiteContent: vi.fn(async () => ({
		band: {
			id: 'b1',
			name: 'The Neons',
			slug: 'the-neons',
			bio: 'A band from somewhere.',
			tagline: 'Loud and bright',
			avatarUrl: null,
			links: [{ label: 'Bandcamp', url: 'https://neons.bandcamp.test' }],
			genres: ['Rock']
		},
		members: [{ id: 'm1', name: 'Neon Jo', image: null, position: 'Drums', role: 'admin' }],
		events: [
			{
				id: 'e1',
				title: 'Spring show',
				startsAt: new Date('2026-12-01T03:00:00Z'),
				location: 'The Hall'
			}
		]
	}))
}));

const allowRateLimited = vi.fn(async (_key: string, _max: number, _ttl: number) => true);
vi.mock('#lib/server/rate-limit.js', () => ({
	allowRateLimited: (key: string, max: number, ttl: number) => allowRateLimited(key, max, ttl)
}));

import { GET } from './+server';

const EPK = {
	bookingContact: { name: 'Booker Bea', email: 'booking@private.test', phone: '541-555-0101' },
	managementContact: { name: 'Manager Max', email: 'manager@private.test', phone: '541-555-0102' },
	prContact: { name: 'Press Pat', email: 'press@private.test' },
	pressQuotes: [{ quote: 'Blindingly good.', publication: 'The Gazette' }],
	achievements: ['Won the battle of the bands'],
	videos: [{ url: 'https://video.private.test/live', label: 'Live at the Hall' }]
};

function joined(
	tier: string | null,
	domain: { customDomain: string; customDomainStatus: string } | null = null
) {
	return {
		band: { id: 'b1', name: 'The Neons', slug: 'the-neons', avatarKey: null, deletedAt: null },
		entry: {
			hometown: 'Hometown Private',
			foundedYear: '1999',
			contactEmail: 'enquiries@private.test',
			contactPhone: '541-555-0199'
		},
		site: tier ? { tier, epk: EPK, customDomain: null, ...domain } : null
	};
}

async function call() {
	const event = { params: { slug: 'the-neons' }, getClientAddress: () => '203.0.113.9' };
	try {
		return await GET(event as unknown as Parameters<typeof GET>[0]);
	} catch (e) {
		return e as { status: number };
	}
}

beforeEach(() => {
	getObject.mockClear();
	allowRateLimited.mockClear();
	allowRateLimited.mockResolvedValue(true);
});

describe('GET /band-site/[slug]/epk/press-kit.zip', () => {
	it.each([
		['a free site', [joined('free')]],
		['a band with no site row', [joined(null)]],
		['an unknown or deleted band', []]
	])('refuses %s, the bands whose /epk page 404s', async (_label, rows) => {
		selectResult.rows = rows;
		const res = await call();
		expect(res.status).toBe(404);
		expect(getObject).not.toHaveBeenCalled();
	});

	it('refuses once the client is over its rate limit', async () => {
		selectResult.rows = [joined('premium')];
		allowRateLimited.mockResolvedValue(false);
		const res = await call();
		expect(res.status).toBe(429);
		expect(getObject).not.toHaveBeenCalled();
	});

	it('serves the public half of a premium band kit, and nothing the /epk page hides', async () => {
		selectResult.rows = [joined('premium')];
		const res = (await call()) as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('content-disposition')).toContain('the-neons-press-kit.zip');

		const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
		expect(Object.keys(files).sort()).toEqual([
			'photos/press-1.jpg',
			'press-kit.html',
			'press-kit.txt'
		]);

		for (const name of ['press-kit.html', 'press-kit.txt']) {
			const text = strFromU8(files[name]);
			expect(text).toContain('Blindingly good.');
			expect(text).toContain('Neon Jo');
			expect(text).toContain('https://the-neons.corvmc.test/epk');
			expect(text).not.toContain('private.test');
			expect(text).not.toMatch(/541-555/);
			for (const hidden of ['Booker Bea', 'Manager Max', 'Press Pat', 'Hometown Private', '1999']) {
				expect(text).not.toContain(hidden);
			}
		}
	});

	it.each([
		['active', 'https://neons.band.test/epk'],
		['pending', 'https://the-neons.corvmc.test/epk']
	])('links to the page on the custom domain only once it is live (%s)', async (status, url) => {
		selectResult.rows = [
			joined('premium', { customDomain: 'neons.band.test', customDomainStatus: status })
		];
		const files = unzipSync(new Uint8Array(await ((await call()) as Response).arrayBuffer()));
		for (const name of ['press-kit.html', 'press-kit.txt']) {
			expect(strFromU8(files[name])).toContain(url);
		}
	});
});
