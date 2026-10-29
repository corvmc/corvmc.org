import { z } from 'zod';
import { allRosterRows, rosterCsv } from '$lib/server/roster/roster';
import { listVolunteers, type VolunteerListRow } from './volunteer-profile-service';
import { volunteerProfileStatuses } from '$lib/config';

/**
 * The volunteers roster's filters under the keys its page writes to the URL,
 * so the export and "copy emails" read exactly the view on screen. An unknown
 * status is dropped rather than refused, as the page's own `oneOf` does.
 */
export const volunteerRosterFilters = z.object({
	q: z.string().optional(),
	role: z.string().optional(),
	status: z.enum(volunteerProfileStatuses).optional().catch(undefined),
	cert: z.string().optional()
});

export type VolunteerRosterFilters = z.infer<typeof volunteerRosterFilters>;

/** Everyone the filters match, unpaginated. */
export function listAllVolunteers(f: VolunteerRosterFilters): Promise<VolunteerListRow[]> {
	return allRosterRows((pagination) =>
		listVolunteers(
			{
				search: f.q || undefined,
				roleId: f.role || undefined,
				status: f.status,
				certificationId: f.cert || undefined
			},
			pagination
		)
	);
}

export function volunteerRosterCsv(rows: VolunteerListRow[]): string {
	return rosterCsv(rows, [
		{ header: 'status', value: (r) => r.status },
		{ header: 'under_18', value: (r) => (r.isAdult ? 'no' : 'yes') },
		{ header: 'roles', value: (r) => r.roleNames.join('; ') },
		{ header: 'hours', value: (r) => (r.minutes / 60).toFixed(2) },
		{ header: 'phone', value: (r) => r.phone },
		{ header: 'availability', value: (r) => r.availability },
		{ header: 'since', value: (r) => r.since.toISOString().slice(0, 10) }
	]);
}
