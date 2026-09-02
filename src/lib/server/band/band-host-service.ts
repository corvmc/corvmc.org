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
import type { GroupKind } from '$lib/config';
import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { bandSite } from '$lib/server/db/schema/band-site';
import { getJson, putJson } from '$lib/server/kv';

/** Custom-domain lookups are cached this long. Short: a band that just verified shouldn't wait. */
const HOST_CACHE_TTL_SECONDS = 300;
const HOST_CACHE_PREFIX = 'band-host:';

export type BandHost = {
	slug: string;
	/**
	 * What kind of group holds the address. Not every subdomain is a band's: the
	 * lookup matches `group` by slug, and clubs and committees live in that same
	 * table, so the redirect target has to be chosen per kind
	 * (`groupPublicPath`). Custom domains are premium and therefore always a
	 * band, but they report the column too rather than assuming it.
	 */
	kind: GroupKind;
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
	// One indexed lookup plus a join since phase 3b: `tier` moved to `band_site`.
	// Still uncached, and still cheap — `group.slug` is unique and the join is on
	// `band_site.group_id`, which is too. A band with no site row reads as free,
	// which is the same answer this gave before the column moved.
	const [row] = await db
		.select({ slug: group.slug, kind: group.kind, tier: bandSite.tier })
		.from(group)
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(and(eq(group.slug, slug), isNull(group.deletedAt)))
		.limit(1);

	if (!row) return null;
	// `kind` is one more column on a query that already reads this row, not a
	// second lookup: the hook needs it to pick between the band directory and
	// the group page, and only a band has a microsite to serve in the first
	// place.
	return {
		slug: row.slug,
		kind: row.kind,
		servesSite: row.kind === 'band' && row.tier === 'premium'
	};
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

	// The domain and the tier both live on `band_site` now, so this reads from
	// there and joins back for the slug — the opposite direction to
	// `resolveBandSubdomain`, because the lookup key moved with the columns.
	// INNER: no site row means no custom domain to match in the first place.
	//
	// This runs from `reroute`, before routing, on every request to a custom
	// host. The KV cache above is what keeps that affordable, so the join cost
	// lands on cache misses only.
	const [row] = await db
		.select({
			slug: group.slug,
			kind: group.kind,
			tier: bandSite.tier,
			status: bandSite.customDomainStatus
		})
		.from(bandSite)
		.innerJoin(group, eq(group.id, bandSite.groupId))
		.where(and(eq(bandSite.customDomain, host), isNull(group.deletedAt)))
		.limit(1);

	const resolved: BandHost | null =
		row && row.status === 'active' && row.tier === 'premium'
			? { slug: row.slug, kind: row.kind, servesSite: true }
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
