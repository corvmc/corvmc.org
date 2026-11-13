import { error } from '@sveltejs/kit';
import { can, requireUser } from '#lib/server/authorization.js';
import { mapDomainError } from '#lib/server/errors.js';
import type { Capability, PartyRole } from '#lib/config.js';
import { getOrganization, type OrganizationWithRoles } from './organization-service';

/**
 * Who may open an organization (#2622): contacts staff open any; a role's own
 * capability opens the organizations holding that role, so the treasurer still
 * reaches contractors and sponsors. The people on them need `contact.read`.
 */
export const ROLE_CAPABILITY: Partial<Record<PartyRole, Capability>> = {
	funder: 'grant.read',
	sponsor: 'sponsor.read',
	contractor: 'contractor.read',
	supplier: 'inventory.manageOrders',
	vendor: 'event.manage'
};

/** May the viewer open organizations in this role? Contacts staff may open any. */
export async function canSeeRole(role: PartyRole | 'all'): Promise<boolean> {
	if (await can('contact.read')) return true;
	const cap = role === 'all' ? undefined : ROLE_CAPABILITY[role];
	return cap ? can(cap) : false;
}

/** The organization, refused unless one of its roles is open to the viewer. */
export async function requireOrganizationReader(id: string): Promise<OrganizationWithRoles> {
	requireUser();
	let org: OrganizationWithRoles;
	try {
		org = await getOrganization(id);
	} catch (err) {
		mapDomainError(err);
	}
	const allowed = await Promise.all(
		[...org.roles, 'all' as const].map((r) => canSeeRole(r as PartyRole | 'all'))
	);
	if (!allowed.some(Boolean)) error(403, 'Forbidden');
	return org;
}
