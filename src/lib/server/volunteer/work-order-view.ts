import {
	getShiftDetail,
	getShiftCancelledByName,
	listWorkOrderAssignees
} from './work-order-service';
import { listClaimants, listInvitationsForShift } from './volunteer-signup-service';
import { listFeedbackForWorkOrder } from './volunteer-feedback-service';
import { listWorkTasks } from './duty-list-service';
import { listHourLogs } from './hour-log-service';
import { listJobs } from '#lib/server/contractor/contractor-job-service.js';
import { listFlagsForWorkOrder } from '#lib/server/inventory/work-request-service.js';

/**
 * Everything one work order's page shows, read through services. Unguarded:
 * the two remotes that serve it (`getStaffShiftPage`, `getProjectTaskPage`)
 * each guard first, by different rules, and then call this.
 * `null` when there is no such work order.
 */
export async function loadWorkOrderView(id: string) {
	const shift = await getShiftDetail(id);
	if (!shift) return null;
	// The roster is the current shift's (`getCurrentShift`); a task with no shift has none.
	const shiftId = shift.shiftId;
	const [
		claimants,
		cancelledByName,
		feedback,
		tasks,
		invitations,
		engagements,
		reports,
		hours,
		assignees
	] = await Promise.all([
		shiftId ? listClaimants(shiftId) : Promise.resolve([]),
		shift.cancelledAt ? getShiftCancelledByName(id) : Promise.resolve(null),
		listFeedbackForWorkOrder(id),
		listWorkTasks(id),
		// Neither holds a place, so they are apart from the claimants.
		shiftId ? listInvitationsForShift(shiftId) : Promise.resolve([]),
		listJobs({ workOrderId: id }),
		listFlagsForWorkOrder(id),
		listHourLogs({ workOrderId: id }, { page: 1, pageSize: 100 }),
		listWorkOrderAssignees(id)
	]);
	return {
		shift: { ...shift, cancelledByName },
		claimants,
		assignees,
		feedback,
		tasks,
		invitations,
		engagements,
		reports,
		hours: hours.rows
	};
}

export type WorkOrderView = NonNullable<Awaited<ReturnType<typeof loadWorkOrderView>>>;
