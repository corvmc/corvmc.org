/**
 * Every path whose bare URL has answered a 308, past or present. Browsers keep
 * a 308 with no expiry, so an entry stays after its redirect is removed. A 308
 * into an entry that no longer redirects goes through `pastCachedRedirect`, or a
 * browser holding the old 308 loops (#2961). `src/routes/redirect-loops.spec.ts`
 * fails on a current 308 source missing here and on a bare redirect into an entry.
 */
export const permanentRedirectSources: readonly string[] = [
	'/band/[slug]/chat',
	'/band/[slug]/page-editor/epk',
	'/band/[slug]/profile',
	'/member/directory/instructors',
	'/member/events/submit',
	'/member/volunteer/committees',
	'/member/volunteer/hours',
	'/staff/access',
	'/staff/audit',
	'/staff/bands',
	'/staff/bands/[id]',
	'/staff/bands/acts',
	'/staff/calendar',
	'/staff/closures',
	'/staff/clubs',
	'/staff/clubs/[id]',
	'/staff/committees',
	'/staff/committees/[id]',
	'/staff/contractors',
	'/staff/contractors/[id]',
	'/staff/contractors/jobs',
	'/staff/credits',
	'/staff/flags',
	'/staff/flags/equipment',
	'/staff/flags/equipment/[id]',
	'/staff/grants/funders',
	'/staff/groups',
	'/staff/groups/bands',
	'/staff/groups/clubs',
	'/staff/groups/committees',
	'/staff/incidents',
	'/staff/instructors',
	'/staff/inventory/acquisitions',
	'/staff/inventory/compliance',
	'/staff/inventory/orders',
	'/staff/inventory/restock',
	'/staff/inventory/spend',
	'/staff/inventory/tagging',
	'/staff/keys',
	'/staff/local-resources/tips',
	'/staff/members/instructors',
	'/staff/members/invites',
	'/staff/members/volunteers',
	'/staff/members/volunteers/hours',
	'/staff/payments',
	'/staff/productions',
	'/staff/project-templates',
	'/staff/project-templates/[id]',
	'/staff/projects/[...rest]',
	'/staff/recurring',
	'/staff/recurring-work',
	'/staff/reports/acquisitions',
	'/staff/settings',
	'/staff/sponsors/[id]',
	'/staff/tasks/productions',
	'/staff/users',
	'/staff/users/[id]',
	'/staff/venues',
	'/staff/volunteer',
	'/staff/volunteer/certifications',
	'/staff/volunteer/clearances',
	'/staff/volunteer/duty-lists',
	'/staff/volunteer/duty-lists/[id]',
	'/staff/volunteer/hours',
	'/staff/volunteer/interest',
	'/staff/volunteer/people',
	'/staff/volunteer/recurring',
	'/staff/volunteer/report',
	'/staff/volunteer/report/export',
	'/staff/volunteer/roles',
	'/staff/volunteer/schedule',
	'/staff/volunteer/schedule/recurring',
	'/staff/volunteer/setup',
	'/staff/volunteer/shifts',
	'/staff/volunteer/shifts/[id]'
];

/** The query key `pastCachedRedirect` adds. Not `from`: Acquisitions reads that as a date. */
export const pastCachedKey = 'via';

/** `target` with `via=<source>` added, so a browser's cached 308 for it does not match. */
export function pastCachedRedirect(target: string, source: string): string {
	const [path, hash] = target.split('#', 2);
	const joined = `${path}${path.includes('?') ? '&' : '?'}${pastCachedKey}=${encodeURIComponent(source)}`;
	return hash === undefined ? joined : `${joined}#${hash}`;
}
