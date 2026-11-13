import { z } from 'zod';
import { query } from '$app/server';
import { can, requireCapability } from '#lib/server/authorization.js';
import { listFunding } from '#lib/server/development/funding-service.js';
import { listFundableProjects } from '#lib/server/development/funding-project.js';
import { listFunders } from '#lib/server/grant/funder-service.js';
import { listOrganizations } from '#lib/server/party/organization-service.js';
import { clubToday } from '#lib/config.js';

/**
 * The Funding page (#2622): grant applications and sponsorships together. Each
 * half is read only by a viewer holding that module's `read`; somebody with
 * neither is refused. The create forms' pickers ride along, one load-bearing
 * query per page, and only for a viewer who may create.
 */
export const getFunding = query(
	z.object({ includeClosed: z.boolean().optional() }),
	async ({ includeClosed }) => {
		const [grants, sponsors, manageGrants, manageSponsors] = await Promise.all([
			can('grant.read'),
			can('sponsor.read'),
			can('grant.manage'),
			can('sponsor.manage')
		]);
		if (!grants && !sponsors) await requireCapability('grant.read');

		const [rows, funderRows, sponsorRows, projects] = await Promise.all([
			listFunding({ today: clubToday(), grants, sponsors, includeClosed }),
			manageGrants ? listFunders() : Promise.resolve([]),
			manageSponsors ? listOrganizations({ role: 'sponsor' }) : Promise.resolve([]),
			manageGrants || manageSponsors ? listFundableProjects() : Promise.resolve([])
		]);
		const pick = (r: { id: string; name: string }) => ({ id: r.id, name: r.name });
		return {
			rows,
			shows: { grants, sponsors },
			canCreate: { grants: manageGrants, sponsors: manageSponsors },
			funders: funderRows.map(pick),
			sponsors: sponsorRows.map(pick),
			projects
		};
	}
);
