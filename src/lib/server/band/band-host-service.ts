/**
 * Resolves an incoming hostname to the band it belongs to, and decides what
 * that address should serve.
 *
 * Two kinds of band address exist:
 *  - `{slug}.corvmc.org` — every band has one, free. Premium bands get their
 *    block-editor microsite; everyone else is redirected to their directory
 *    profile, so the address always resolves to *something* about the band.
 *  - a custom domain — premium only, backed by a Cloudflare for SaaS custom
 *    hostname (see custom-domain-service.ts).
 */
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { getJson, putJson } from '$lib/server/kv';

/** Custom-domain lookups are cached this long. Short: a band that just verified shouldn't wait. */
const HOST_CACHE_TTL_SECONDS = 300;
const HOST_CACHE_PREFIX = 'band-host:';

export type BandHost = {
	slug: string;
	/** True when this address should render the microsite rather than redirect. */
	servesSite: boolean;
};

/**
 * The band behind a `{slug}.<baseDomain>` subdomain, or null if no such band.
 *
 * Not cached: it is a single indexed lookup on a hot path where staleness would
 * mean a band that just upgraded still gets redirected away from its new site.
 */
export async function resolveBandSubdomain(slug: string): Promise<BandHost | null> {
	const [row] = await db
		.select({ slug: group.slug, tier: group.tier })
		.from(group)
		.where(and(eq(group.slug, slug), isNull(group.deletedAt)))
		.limit(1);

	if (!row) return null;
	return { slug: row.slug, servesSite: row.tier === 'premium' };
}

/**
 * The band that owns a custom domain, or null. Only `active` domains resolve —
 * a pending one hasn't proven ownership yet, and serving it early would let
 * anyone claim a hostname they don't control.
 *
 * KV-cached because this runs from `reroute`, i.e. before routing, on requests
 * that would otherwise never touch the database.
 */
export async function resolveCustomDomain(hostname: string): Promise<BandHost | null> {
	const host = hostname.toLowerCase();
	const cacheKey = `${HOST_CACHE_PREFIX}${host}`;

	const cached = await getJson<BandHost | { miss: true }>(cacheKey);
	if (cached) return 'miss' in cached ? null : cached;

	const [row] = await db
		.select({ slug: group.slug, tier: group.tier, status: group.customDomainStatus })
		.from(group)
		.where(and(eq(group.customDomain, host), isNull(group.deletedAt)))
		.limit(1);

	const resolved: BandHost | null =
		row && row.status === 'active' && row.tier === 'premium'
			? { slug: row.slug, servesSite: true }
			: null;

	// Cache misses too — an unrelated host hitting the worker shouldn't cost a
	// query every request.
	await putJson(cacheKey, resolved ?? { miss: true }, HOST_CACHE_TTL_SECONDS);
	return resolved;
}

/** Drop a cached lookup so a domain change takes effect immediately. */
export async function forgetCustomDomain(hostname: string): Promise<void> {
	await putJson(`${HOST_CACHE_PREFIX}${hostname.toLowerCase()}`, { miss: true }, 1);
}
