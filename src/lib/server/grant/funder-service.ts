import { db } from '#lib/server/db/index.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { listOrganizations } from '#lib/server/party/organization-service.js';

/**
 * A funder is an organization holding the `funder` role (#2622). This module
 * lists them with their application counts.
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
