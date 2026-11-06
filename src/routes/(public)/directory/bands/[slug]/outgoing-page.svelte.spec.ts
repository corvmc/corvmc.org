import { settled } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const BAND_ROUTE = '/(public)/directory/bands/[slug]';

const remote = vi.hoisted(() => ({
	getPublicBandProfile: vi.fn(),
	getBandShows: vi.fn(),
	getBandPastShows: vi.fn()
}));

const fakePage = $state({
	params: { slug: 'plumfoot' } as Record<string, string>,
	route: { id: BAND_ROUTE },
	url: new URL('http://localhost/directory/bands/plumfoot')
});

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('#lib/remote/directory.remote.js', () => remote);
vi.mock('$app/state', async (original) => ({
	...(await original<Record<string, unknown>>()),
	get page() {
		return fakePage;
	}
}));

const BandPage = (await import('./+page.svelte')).default;

const PROFILE = {
	band: {
		id: 'band-1',
		slug: 'plumfoot',
		name: 'Plumfoot',
		tagline: null,
		genres: [],
		memberCount: 1,
		lookingForMembers: false,
		foundedYear: null,
		hometown: null,
		avatarUrl: null,
		bio: null,
		links: [],
		releases: [],
		photos: [],
		pressKit: { pressQuotes: [], achievements: [], videos: [] }
	},
	members: [],
	related: []
};

async function renderBandPage() {
	render(BandPage);
	await vi.waitFor(() => expect(remote.getBandShows).toHaveBeenCalled());
	await settled();
}

describe('a band profile being navigated away from', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fakePage.params = { slug: 'plumfoot' };
		fakePage.route = { id: BAND_ROUTE };
		remote.getPublicBandProfile.mockImplementation((slug: unknown) =>
			slug === undefined
				? Promise.reject(new Error('rejected by the argument schema'))
				: Promise.resolve(PROFILE)
		);
		remote.getBandShows.mockResolvedValue({
			upcoming: [],
			past: [],
			pastCount: 0,
			pastHasMore: false
		});
	});

	it('does not query again when the next route has no slug param', async () => {
		await renderBandPage();

		// What `apply_navigation_result` writes for /events/[id], this page still mounted.
		fakePage.params = { id: 'event-1' };
		fakePage.route = { id: '/(public)/events/[id]' };
		await settled();

		expect(remote.getPublicBandProfile.mock.calls).toEqual([['plumfoot']]);
	});

	it('does not query the next route value of a param with the same name', async () => {
		await renderBandPage();

		fakePage.params = { slug: 'a-group' };
		fakePage.route = { id: '/(public)/groups/[slug]' };
		await settled();

		expect(remote.getPublicBandProfile.mock.calls).toEqual([['plumfoot']]);
	});

	it('still follows the param to another band on the same route', async () => {
		await renderBandPage();

		fakePage.params = { slug: 'other-band' };
		await settled();

		expect(remote.getPublicBandProfile).toHaveBeenLastCalledWith('other-band');
	});
});
