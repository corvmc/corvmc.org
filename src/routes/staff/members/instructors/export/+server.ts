import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/authorization';
import {
	instructorRosterCsv,
	instructorRosterFilters,
	listAllInstructors
} from '$lib/server/instructor/instructor-roster';
import { csvResponse } from '$lib/server/report/csv';

/** The Instructors view as CSV, filtered as the page is; guarded as its remote is. */
export const GET: RequestHandler = async ({ url }) => {
	await requireCapability('instructor.read');
	const filters = instructorRosterFilters.parse(Object.fromEntries(url.searchParams));
	return csvResponse('instructors.csv', instructorRosterCsv(await listAllInstructors(filters)));
};
