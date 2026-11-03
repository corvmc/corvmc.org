import type { RequestHandler } from './$types';
import { requireCapability } from '#lib/server/authorization.js';
import {
	listAllStaffUsers,
	userRosterCsv,
	userRosterFilters
} from '#lib/server/user/user-roster.js';
import { csvResponse } from '#lib/server/report/csv.js';

/** The All view as CSV, filtered as the page is; guarded as its remote is. */
export const GET: RequestHandler = async ({ url }) => {
	await requireCapability('user.list');
	const rows = await listAllStaffUsers(
		userRosterFilters.parse(Object.fromEntries(url.searchParams))
	);
	return csvResponse('members.csv', userRosterCsv(rows));
};
