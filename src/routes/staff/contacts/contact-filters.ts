import { partyRoles, type PartyRole } from '#lib/config.js';

/**
 * The Contacts list's role filter in the URL (#2760): `role=funder,sponsor`.
 * Anything not a role drops out, since the query string is user input.
 */
export function parseRoles(raw: string): PartyRole[] {
	const asked = new Set(raw.split(','));
	return partyRoles.filter((r) => asked.has(r));
}

export function encodeRoles(roles: readonly PartyRole[]): string {
	return partyRoles.filter((r) => roles.includes(r)).join(',');
}

/** The role filter with `role` turned on or off. */
export function toggleRole(raw: string, role: PartyRole, on: boolean): string {
	const roles = parseRoles(raw).filter((r) => r !== role);
	return encodeRoles(on ? [...roles, role] : roles);
}

/**
 * The create modal's starting role: the one role filtered on, else partner.
 * Contractors carry a trade, so they are added from their own page.
 */
export function defaultCreateRole(roles: readonly PartyRole[]): PartyRole {
	return roles.length === 1 && roles[0] !== 'contractor' ? roles[0] : 'partner';
}

/**
 * Where a link from the tabbed page lands: `?view=funder` becomes
 * `?role=funder`, and `?view=all` the unfiltered list. Null when there is no
 * old parameter to move.
 */
export function legacyContactsHref(url: URL): string | null {
	const view = url.searchParams.get('view');
	if (view === null) return null;
	const pairs = [...url.searchParams].filter(([k]) => k !== 'view' && k !== 'role');
	const role = parseRoles(view);
	if (role.length > 0) pairs.unshift(['role', encodeRoles(role)]);
	const query = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
	return query ? `${url.pathname}?${query}` : url.pathname;
}
