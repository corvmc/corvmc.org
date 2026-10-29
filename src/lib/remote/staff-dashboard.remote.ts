import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { clubToday, type Capability } from '$lib/config';
import {
	capabilitySet,
	committeeCapabilitiesFor,
	positionsFor,
	requireUser
} from '$lib/server/authorization';
import { listLowStock } from '$lib/server/inventory/stock-service';
import { listShortStaffedShifts } from '$lib/server/volunteer/work-order-service';
import { listDevelopmentDeadlinesBetween } from '$lib/server/development/deadline-service';
import {
	listMemberSummary,
	listRoomDays,
	listUpcomingShows
} from '$lib/server/user/staff-dashboard-service';
import { countStaffQueues } from '$lib/server/user/staff-queue-counts';
import { addIsoDays } from '$lib/utils/deadline';

/** A glance at this week's short shifts; the two-week view is /staff/volunteer. */
const SHIFT_HORIZON_DAYS = 7;
/** Each list is capped: the dashboard is a glance, and its link opens the whole thing. */
const CAP = 5;

async function deadlinesFor(holds: (c: Capability) => boolean) {
	const grants = holds('grant.read');
	const sponsors = holds('sponsor.read');
	if (!grants && !sponsors) return null;
	const today = clubToday();
	const rows = await listDevelopmentDeadlinesBetween('0000-01-01', addIsoDays(today, 30), {
		grants,
		sponsors
	});
	return rows.map((d) => ({ ...d, overdue: d.on < today }));
}

const capped = <T>(rows: T[] | null) =>
	rows ? { rows: rows.slice(0, CAP), total: rows.length } : null;

/**
 * The staff dashboard: the page's one load-bearing query.
 *
 * Admits whoever may open the panel (a position or an org-wide committee seat,
 * as `getStaffLayout`) and fetches each section only for a viewer holding the
 * capability its own page guards on. A section the viewer cannot read is
 * `null`, not empty, so the page can tell "nothing today" from "not yours".
 */
export const getStaffDashboard = query(async () => {
	const me = requireUser();
	const [positions, seat] = await Promise.all([
		positionsFor(me.id),
		committeeCapabilitiesFor(me.id).catch(() => [] as Capability[])
	]);
	const capabilities = [...new Set([...capabilitySet(positions), ...seat])];
	if (capabilities.length === 0) error(403, 'Not permitted');
	const holds = (c: Capability) => capabilities.includes(c);

	const [room, shows, queues, lowStock, shortShifts, deadlines, members] = await Promise.all([
		holds('reservation.read') ? listRoomDays() : null,
		holds('event.read') ? listUpcomingShows() : null,
		countStaffQueues(),
		holds('inventory.report') ? listLowStock() : null,
		holds('volunteer.read') ? listShortStaffedShifts(SHIFT_HORIZON_DAYS) : null,
		deadlinesFor(holds),
		holds('user.list') ? listMemberSummary() : null
	]);

	return {
		capabilities,
		room,
		shows,
		queues,
		lowStock: capped(lowStock),
		shortShifts: capped(shortShifts),
		deadlines: capped(deadlines),
		members
	};
});
