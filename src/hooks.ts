import type { Reroute } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { bandSlugFromHost, isAppDomain } from '$lib/utils/band-site-url';

/** Resolves a custom domain to the band whose site it serves. See src/routes/api/host-route. */
const HOST_ROUTE_ENDPOINT = '/api/host-route';

/**
 * Reroute band addresses to the band-site route group.
 *   the-neons.corvmc.org/events → /band-site/the-neons/events
 *   theband.com/events (custom domain) → /band-site/the-neons/events
 *
 * Rerouting is only half the story: this hook runs on the client too, so it
 * can't read the database. Whether a band's subdomain actually *serves* the
 * microsite or redirects to its directory profile is decided in
 * `src/hooks.server.ts`, which can.
 */
export const reroute: Reroute = async ({ url, fetch }) => {
	// The lookup below is an ordinary request, so it comes back through here. Without
	// this guard it reroutes into another lookup, forever.
	if (url.pathname === HOST_ROUTE_ENDPOINT) return url.pathname;

	// In dev, we can't use real subdomains easily, so support a query param override:
	// http://localhost:5173?__band_subdomain=the-neons
	const devOverride = url.searchParams.get('__band_subdomain');
	if (devOverride) {
		return `/band-site/${devOverride}${url.pathname}`;
	}

	const slug = bandSlugFromHost(url.hostname, env.PUBLIC_SITE_URL);
	if (slug) return `/band-site/${slug}${url.pathname}`;

	// Not our domain at all — either an unrelated host (workers.dev, an IP) or a
	// premium band's custom domain. Only the app can tell the two apart, so ask
	// it. `/api/host-route` is cheap and its answer is cached per URL on the
	// client; on the server it is a KV-cached lookup.
	if (isAppDomain(url.hostname, env.PUBLIC_SITE_URL)) return url.pathname;

	try {
		const api = new URL(HOST_ROUTE_ENDPOINT, url);
		api.searchParams.set('host', url.hostname);
		const { slug: customSlug } = (await fetch(api).then((r) => r.json())) as {
			slug: string | null;
		};
		if (customSlug) return `/band-site/${customSlug}${url.pathname}`;
	} catch {
		// A failed lookup must not break navigation — fall through to the app.
	}

	return url.pathname;
};
