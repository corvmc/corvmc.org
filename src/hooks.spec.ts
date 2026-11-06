import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/env/public', async () =>
	(await import('#lib/testing/env-mock.js')).envMock({ PUBLIC_SITE_URL: 'https://corvmc.org' })
);

import { reroute } from './hooks';

type RerouteArgs = { url: URL; fetch: typeof fetch };

/** Custom-domain lookups go through /api/host-route; most cases never call it. */
function run(url: string, hostRouteSlug: string | null = null) {
	const fetchMock = vi.fn(async () =>
		Response.json({ slug: hostRouteSlug })
	) as unknown as typeof fetch;
	const result = (reroute as (event: RerouteArgs) => Promise<string | undefined>)({
		url: new URL(url),
		fetch: fetchMock
	});
	return Object.assign(result, { fetchMock });
}

describe('reroute', () => {
	it('maps band subdomains to /band-site/{slug}', async () => {
		expect(await run('https://the-neons.corvmc.org/')).toBe('/band-site/the-neons/');
		expect(await run('https://the-neons.corvmc.org/events')).toBe('/band-site/the-neons/events');
		expect(await run('https://the-neons.corvmc.org/epk')).toBe('/band-site/the-neons/epk');
	});

	it('maps every band, not just premium ones — the server decides what to serve', async () => {
		// reroute runs on the client too, so it can't know a band's tier. It always
		// points at the band-site route; hooks.server.ts redirects free bands from
		// there to their directory profile.
		const call = run('https://some-free-band.corvmc.org/');
		expect(await call).toBe('/band-site/some-free-band/');
		expect(call.fetchMock).not.toHaveBeenCalled();
	});

	it('leaves the apex and www untouched', async () => {
		expect(await run('https://corvmc.org/member')).toBe('/member');
		expect(await run('https://www.corvmc.org/')).toBe('/');
	});

	it('leaves reserved subdomains untouched', async () => {
		expect(await run('https://media.corvmc.org/bands/x.jpg')).toBe('/bands/x.jpg');
		expect(await run('https://api.corvmc.org/health')).toBe('/health');
		expect(await run('https://admin.corvmc.org/')).toBe('/');
		expect(await run('https://staging.corvmc.org/login')).toBe('/login');
	});

	it('ignores nested subdomains', async () => {
		expect(await run('https://a.b.corvmc.org/')).toBe('/');
	});

	it('never asks the host-route endpoint about our own domain', async () => {
		const call = run('https://corvmc.org/directory');
		await call;
		expect(call.fetchMock).not.toHaveBeenCalled();
	});

	it('never reroutes the lookup endpoint itself', async () => {
		// The lookup is an ordinary request, so it comes back through reroute. Without
		// a guard it triggers another lookup and the request hangs forever.
		const call = run('https://theband.com/api/host-route?host=theband.com', 'the-neons');
		expect(await call).toBe('/api/host-route');
		expect(call.fetchMock).not.toHaveBeenCalled();
	});

	it('maps a premium band custom domain via the host-route lookup', async () => {
		expect(await run('https://theband.com/events', 'the-neons')).toBe(
			'/band-site/the-neons/events'
		);
	});

	it('leaves unrelated hosts untouched when the lookup finds no band', async () => {
		expect(await run('https://corvmc.devon-cash.workers.dev/member', null)).toBe('/member');
	});

	it('falls through to the app when the lookup fails', async () => {
		const failing = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		const result = await (reroute as (event: RerouteArgs) => Promise<string | undefined>)({
			url: new URL('https://theband.com/events'),
			fetch: failing
		});
		expect(result).toBe('/events');
	});

	it('supports the dev override query param', async () => {
		expect(await run('http://localhost:5173/?__band_subdomain=the-neons')).toBe(
			'/band-site/the-neons/'
		);
		expect(await run('http://localhost:5173/events?__band_subdomain=the-neons')).toBe(
			'/band-site/the-neons/events'
		);
	});
});
