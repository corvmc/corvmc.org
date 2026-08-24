/**
 * Slugs that can never be claimed as a band subdomain ({slug}.corvmc.org).
 * Used by the reroute hook (to leave system subdomains alone) and by band
 * slug generation (so no band ever claims one). Universal module — safe to
 * import from both client and server code.
 */
export const RESERVED_SLUGS = new Set([
	// System subdomains (media = R2 public bucket)
	'www',
	'api',
	'mail',
	'email',
	'smtp',
	'imap',
	'staging',
	'dev',
	'test',
	'preview',
	'media',
	'cdn',
	'assets',
	'static',
	// Cloudflare for SaaS plumbing: `saas` is the fallback origin and `domains`
	// is the CNAME target premium bands point their own domain at
	// (custom-domain-service.ts `cnameTarget()`). A band claiming either would
	// collide with the record that makes every custom domain work.
	'saas',
	'domains',
	'fallback',
	'status',
	// App areas and generic names bands shouldn't squat
	'admin',
	'staff',
	'member',
	'members',
	'band',
	'bands',
	'band-site',
	'login',
	'logout',
	'signup',
	'register',
	'auth',
	'account',
	'app',
	'events',
	'directory',
	'help',
	'support',
	'docs',
	'blog',
	'news',
	'shop',
	'store',
	'donate',
	'corvmc',
	'cmc',
	// Group vocabulary, reserved ahead of the groups module (docs/specs/groups-spec.md).
	// A word is free to reserve while nothing holds it and impossible to reclaim
	// afterwards, so these land before the first group exists rather than after.
	// `class`/`classes` are here even though classes are out of scope, for that
	// reason alone; `act`/`acts` protect the contact-sheet root at /act/{token}.
	'group',
	'groups',
	'club',
	'clubs',
	'class',
	'classes',
	'committee',
	'committees',
	'file',
	'files',
	'act',
	'acts',
	// Live top-level route roots. These never collided as *paths* — a band slug
	// only ever appears nested, under /band/{slug} or /directory/bands/{slug} —
	// but this set governs subdomains, so without them a band could hold
	// membership.corvmc.org or contribute.corvmc.org.
	'about',
	'contact',
	'contribute',
	'local-resources',
	'membership',
	'programs',
	'show-tonight',
	'subscribe',
	'unsubscribe'
]);

export function isReservedSlug(slug: string): boolean {
	return RESERVED_SLUGS.has(slug.toLowerCase());
}
