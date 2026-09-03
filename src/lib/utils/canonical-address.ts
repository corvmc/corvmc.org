/**
 * The address a member or a group hands out.
 *
 * Every band already has `{slug}.corvmc.org` and every member now has
 * `corvmc.org/m/{memberNumber}` — the thing Linktree charges for, which this
 * app has always given away and never once named. This module is where "what is
 * the address of X" is decided, once, so a share button and a QR code and an
 * OG tag cannot disagree.
 *
 * Distinct from `entityHref`, which answers *where should this viewer be sent
 * right now* and returns an in-app path. These are absolute, viewer-independent
 * URLs meant to leave the app — printed, pasted into a bio, scanned.
 *
 * Kept free of DB and Svelte dependencies so the policy can be unit-tested as a
 * plain table, the way `entityHref` and `directory-display` are.
 */
import type { GroupKind } from '$lib/config';
import { baseDomainFromSiteUrl } from './band-site-url';

/**
 * Who the address belongs to.
 *
 * `external` is a directory entry with neither a user nor a group — a visiting
 * act on a lineup. `groups-spec.md` is explicit that such an entry has "no
 * public profile, no share link, no short id", so it is a case this module
 * answers `null` to rather than one it has no branch for.
 */
export type AddressSubject =
	| { kind: 'member'; memberNumber: number | null | undefined }
	| { kind: 'group'; slug: string | null | undefined }
	| { kind: 'external' };

/**
 * The absolute public address of a subject, or `null` when it has none.
 *
 * `null` is a normal outcome, not a failure: an external act has no address by
 * design, and a member whose number has not been issued yet has none until the
 * backfill or their next signup-hook run gives them one. Callers fall back to
 * the URL the visitor is already on — never share a broken link.
 *
 * `siteUrl` is `PUBLIC_SITE_URL`; `origin` is where member paths hang off, and
 * defaults to the site URL's own origin.
 */
export function canonicalAddress(
	subject: AddressSubject,
	opts: { siteUrl?: string; origin?: string } = {}
): string | null {
	switch (subject.kind) {
		case 'member': {
			if (subject.memberNumber == null) return null;
			const origin = opts.origin ?? originFromSiteUrl(opts.siteUrl);
			return `${origin}/m/${subject.memberNumber}`;
		}
		case 'group': {
			if (!subject.slug) return null;
			// Deliberately not `bandSiteUrl`: that prefers a premium band's custom
			// domain, which is the right answer for "view your live site" and the
			// wrong one for the address every group has for free. A band that has
			// bought a domain can still hand out its subdomain, and one that has
			// not is not offered a URL it does not own.
			return `https://${subject.slug}.${baseDomainFromSiteUrl(opts.siteUrl)}`;
		}
		case 'external':
			return null;
	}
}

function originFromSiteUrl(siteUrl: string | undefined): string {
	if (siteUrl) {
		try {
			return new URL(siteUrl).origin;
		} catch {
			// fall through to the production default
		}
	}
	return 'https://corvmc.org';
}

/**
 * Where `{slug}.<baseDomain>` sends a visitor when the group behind it has no
 * microsite to serve.
 *
 * `resolveBandSubdomain` matches `group` by slug with no `kind` filter, so a
 * club or committee resolves as a subdomain exactly like a band does. Before
 * this existed, every one of them was redirected to `/directory/bands/{slug}`,
 * whose own lookup requires `kind: 'band'` — so `real-book-club.corvmc.org` led
 * to a 404. A club's page is `/groups/{slug}`.
 */
export function groupPublicPath(kind: GroupKind, slug: string): string {
	return kind === 'band' ? `/directory/bands/${slug}` : `/groups/${slug}`;
}
