import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/authorization';
import {
	listAllVolunteers,
	volunteerRosterCsv,
	volunteerRosterFilters
} from '$lib/server/volunteer/volunteer-roster';
import { csvResponse } from '$lib/server/report/csv';

/**
 * The volunteers roster as CSV, filtered as the page is. A `+server.ts` because a
 * download needs `Content-Disposition`, so the page's `volunteer.read` guard is
 * repeated here, first.
 */
export const GET: RequestHandler = async ({ url }) => {
	await requireCapability('volunteer.read');

	const filters = volunteerRosterFilters.parse({
		q: url.searchParams.get('q') ?? undefined,
		role: url.searchParams.get('role') ?? undefined,
		status: url.searchParams.get('status') ?? undefined,
		cert: url.searchParams.get('cert') ?? undefined
	});

	const rows = await listAllVolunteers(filters);
	return csvResponse('volunteers.csv', volunteerRosterCsv(rows));
};
