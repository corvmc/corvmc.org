import { getShiftDetail, getShiftCancelledByName } from './work-order-service';
import { listClaimants, listInvitationsForShift } from './volunteer-signup-service';
import { listFeedbackForShift } from './volunteer-feedback-service';
import { listWorkTasks } from './duty-list-service';
import { listHourLogs } from './hour-log-service';
import { listJobs } from '$lib/server/contractor/contractor-job-service';
import { listFlagsForWorkOrder } from '$lib/server/inventory/work-request-service';

/**
 * Everything one work order's page shows, read through services. Unguarded:
 * the two remotes that serve it (`getStaffShiftPage`, `getProjectTaskPage`)
 * each guard first, by different rules, and then call this.
 * `null` when there is no such work order.
 */
export async function loadWorkOrderView(id: string) {
	const shift = await getShiftDetail(id);
	if (!shift) return null;
	const [claimants, cancelledByName, feedback, tasks, invitations, engagements, reports, hours] =
		await Promise.all([
			listClaimants(id),
			shift.cancelledAt ? getShiftCancelledByName(id) : Promise.resolve(null),
			listFeedbackForShift(id),
			listWorkTasks(id),
			// Neither holds a place, so they are apart from the claimants.
			listInvitationsForShift(id),
			listJobs({ workOrderId: id }),
			listFlagsForWorkOrder(id),
			listHourLogs({ shiftId: id }, { page: 1, pageSize: 100 })
		]);
	return {
		shift: { ...shift, cancelledByName },
		claimants,
		feedback,
		tasks,
		invitations,
		engagements,
		reports,
		hours: hours.rows
	};
}

export type WorkOrderView = NonNullable<Awaited<ReturnType<typeof loadWorkOrderView>>>;
