import { formatDateShort } from '$lib/utils/format';
import type { getStaffVolunteers } from '$lib/remote/volunteer.remote';

export type RosterRow = Awaited<ReturnType<typeof getStaffVolunteers>>['rows'][number];

/**
 * The one thing outstanding about a volunteer: a clearance about to lapse, else
 * a claim of theirs waiting on staff, else nothing. The row's subline and the
 * panel's note read the same answer, so they cannot disagree.
 */
export function subline(
	row: Pick<RosterRow, 'lapse' | 'claim'>
): { tone: string; text: string } | null {
	if (row.lapse) {
		return {
			tone: 'text-warning',
			text: `${row.lapse.certificationName} expires ${formatDateShort(row.lapse.expiresAt!)}`
		};
	}
	if (row.claim) {
		return {
			tone: 'text-info',
			text: `awaiting your confirm · ${row.claim.roleName} ${formatDateShort(row.claim.startsAt)}`
		};
	}
	return null;
}
