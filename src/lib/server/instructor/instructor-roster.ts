import { z } from 'zod';
import { instructorStatuses } from '$lib/config';
import { allRosterRows, rosterCsv } from '$lib/server/roster/roster';
import { listInstructorRoster, type StaffInstructorRow } from './instructor-service';

/**
 * The Instructors view's filters under the keys its page writes to the URL. An
 * absent status is the view's default, who is teaching now; `all` is none.
 */
export const instructorRosterFilters = z.object({
	q: z.string().optional(),
	status: z.enum([...instructorStatuses, 'all']).catch('active')
});

export type InstructorRosterFilters = z.output<typeof instructorRosterFilters>;

export const toServiceFilters = ({ q, status }: InstructorRosterFilters) => ({
	search: q || undefined,
	status: status === 'all' ? undefined : status
});

/** Everyone the filters match, unpaginated. */
export function listAllInstructors(f: InstructorRosterFilters): Promise<StaffInstructorRow[]> {
	return allRosterRows((p) => listInstructorRoster(toServiceFilters(f), p));
}

export function instructorRosterCsv(rows: StaffInstructorRow[]): string {
	return rosterCsv(rows, [
		{ header: 'status', value: (r) => r.status },
		{ header: 'teaches', value: (r) => r.headline },
		{ header: 'accepting_students', value: (r) => (r.acceptingStudents ? 'yes' : 'no') },
		{ header: 'since', value: (r) => (r.grantedAt ?? r.createdAt).toISOString().slice(0, 10) }
	]);
}
