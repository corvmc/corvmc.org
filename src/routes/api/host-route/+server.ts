import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveCustomDomain } from '#lib/server/band/band-host-service.js';

/**
 * Maps a custom domain to the band slug whose site it serves.
 *
 * Called by the `reroute` hook in src/hooks.ts, which runs on both server and
 * client and therefore cannot import server code or hold a request context —
 * the one case where an endpoint is the right shape rather than a remote
 * function. This is routing, not data: the response says which route to render,
 * and reveals nothing that the rendered page doesn't already.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const host = url.searchParams.get('host');
	if (!host) return json({ slug: null });

	const resolved = await resolveCustomDomain(host);

	// Matches the KV cache behind it; keeps repeat client navigations off the
	// origin entirely.
	setHeaders({ 'cache-control': 'public, max-age=300' });
	return json({ slug: resolved?.slug ?? null });
};
