/**
 * Build an internal link for a band site page that works in all three serving
 * modes:
 *  - real band subdomain ({slug}.corvmc.org): plain root-relative paths
 *  - dev override (?__band_subdomain=slug on localhost): keep the query param
 *  - direct path-based access (/band-site/{slug}/...): keep the path prefix
 *
 * `path` is the band-site-relative path ('' for home, '/events', '/epk').
 */
import type { ResolvedPathname } from '$app/types';
import { isReservedSlug } from '$lib/reserved-slugs';

/**
 * The domain band subdomains hang off ({slug}.<domain>), derived from
 * PUBLIC_SITE_URL so staging/preview deploys get their own namespace.
 */
export function baseDomainFromSiteUrl(siteUrl: string | undefined): string {
	if (siteUrl) {
		try {
			return new URL(siteUrl).hostname.replace(/^www\./, '');
		} catch {
			// fall through to the production default
		}
	}
	return 'corvmc.org';
}

/**
 * The band slug a hostname claims, or null when the host isn't a band subdomain.
 *
 * Every band — free or premium — has `{slug}.<baseDomain>`; what that address
 * *serves* is decided server-side in `src/hooks.server.ts` (premium bands get
 * their microsite, everyone else is redirected to their directory profile).
 * This function only answers "which slug, if any", so it stays pure and usable
 * from the universal reroute hook.
 */
export function bandSlugFromHost(hostname: string, siteUrl: string | undefined): string | null {
	const baseDomain = baseDomainFromSiteUrl(siteUrl);
	if (hostname === baseDomain || hostname === `www.${baseDomain}`) return null;
	if (!hostname.endsWith(`.${baseDomain}`)) return null;

	const slug = hostname.slice(0, -(baseDomain.length + 1));
	// Nested subdomains aren't band sites, and system subdomains (media = the R2
	// public bucket) must reach their own origin untouched.
	if (slug.includes('.') || isReservedSlug(slug)) return null;
	return slug;
}

/**
 * The absolute public URL of a band's site ({slug}.<domain>), for links that
 * leave the app shell — "view live site" from the band dashboard, the page
 * editor preview. Protocol and port come from PUBLIC_SITE_URL, so dev gets
 * http://{slug}.localhost:5173 (which the reroute hook handles the same way as
 * a real subdomain) and production gets https://{slug}.corvmc.org.
 *
 * `customDomain` wins when the band has one live — that is the address they
 * paid for, so canonical/OG URLs and outbound links should all use it.
 */
export function bandSiteUrl(
	slug: string,
	siteUrl: string | undefined,
	customDomain?: string | null
): string {
	if (customDomain) return `https://${customDomain}`;

	const baseDomain = baseDomainFromSiteUrl(siteUrl);
	if (siteUrl) {
		try {
			const { protocol, port } = new URL(siteUrl);
			return `${protocol}//${slug}.${baseDomain}${port ? `:${port}` : ''}`;
		} catch {
			// fall through to the production default
		}
	}
	return `https://${slug}.${baseDomain}`;
}

/** The band-site-relative path ('/', '/events', …) of the current URL. */
export function bandSitePath(slug: string, currentUrl: URL): string {
	const prefix = `/band-site/${slug}`;
	if (currentUrl.pathname.startsWith(prefix)) {
		return currentUrl.pathname.slice(prefix.length) || '/';
	}
	return currentUrl.pathname;
}

/**
 * Returns `ResolvedPathname` rather than `string` so callers satisfy
 * `no-navigation-without-resolve` without a disable at every link.
 *
 * The cast is the honest part of the contract and lives here, once: this
 * function returns one of three shapes depending on how the band site is being
 * served — a root-relative path on a band subdomain, that same path carrying
 * `?__band_subdomain=` on localhost, or a `/band-site/{slug}` prefix on direct
 * access. Only the last is a route in this app's tree, so there is no route id
 * for `resolve()` to check. Every branch below is a path this module builds
 * itself, which is why asserting it here is safe in a way that widening the
 * callers' `href` props to `string` would not be.
 */
export function bandSiteHref(slug: string, path: string, currentUrl: URL): ResolvedPathname {
	const devOverride = currentUrl.searchParams.get('__band_subdomain');
	if (devOverride) {
		return `${path || '/'}?__band_subdomain=${encodeURIComponent(devOverride)}` as ResolvedPathname;
	}
	if (currentUrl.pathname.startsWith('/band-site/')) {
		return `/band-site/${slug}${path}` as ResolvedPathname;
	}
	return (path || '/') as ResolvedPathname;
}
