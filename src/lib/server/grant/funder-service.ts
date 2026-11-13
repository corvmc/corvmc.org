import { db } from '#lib/server/db/index.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { count, eq } from 'drizzle-orm';
import {
	createOrganization,
	getOrganizationInRole,
	listOrganizations,
	removeRole,
	deleteUnusedOrganization,
	setOrganizationArchived,
	updateOrganization,
	type OrganizationInput
} from '#lib/server/party/organization-service.js';

/**
 * A funder is an organization holding the `funder` role (#2622). This module
 * keeps the Grants pages' vocabulary over it.
 */

/** Live funders (or all, with the archived filter on), each with its application count. */
export async function listFunders({ includeArchived = false }: { includeArchived?: boolean } = {}) {
	const [funders, apps] = await Promise.all([
		listOrganizations({ role: 'funder', includeArchived }),
		db.select({ organizationId: grantApplication.organizationId }).from(grantApplication)
	]);
	return funders.map((f) => ({
		...f,
		applications: apps.filter((a) => a.organizationId === f.id).length
	}));
}

export type FunderInput = OrganizationInput;

export function createFunder(input: FunderInput) {
	return createOrganization(input, ['funder']);
}

export async function updateFunder(id: string, input: FunderInput): Promise<void> {
	await getOrganizationInRole(id, 'funder');
	await updateOrganization(id, input);
}

/** Off the active list and the application picker; every application stays. */
export async function archiveFunder(id: string): Promise<void> {
	await getOrganizationInRole(id, 'funder');
	await setOrganizationArchived(id, true);
}

export async function restoreFunder(id: string): Promise<void> {
	await getOrganizationInRole(id, 'funder');
	await setOrganizationArchived(id, false);
}

/**
 * Only for a row that should never have been a funder. Refused once an application
 * names it. The organization goes only when nothing else names it.
 */
export async function deleteFunder(id: string): Promise<void> {
	await getOrganizationInRole(id, 'funder');
	const [used] = await db
		.select({ n: count() })
		.from(grantApplication)
		.where(eq(grantApplication.organizationId, id));
	await removeRole(id, 'funder', Number(used?.n ?? 0));
	await deleteUnusedOrganization(id);
}
