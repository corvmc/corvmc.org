import {
	getShiftDetail,
	getShiftCancelledByName,
	getWorkOrderById,
	listTaskShifts,
	listWorkOrderAssignees
} from './work-order-service';
import { listClaimants, listInvitationsForShift } from './volunteer-signup-service';
import { listFeedbackForWorkOrder } from './volunteer-feedback-service';
import { listWorkTasks } from './duty-list-service';
import { listHourLogs } from './hour-log-service';
import { listJobs } from '#lib/server/contractor/contractor-job-service.js';
import { listFlagsForWorkOrder } from '#lib/server/inventory/work-request-service.js';

/**
 * Everything one task's page shows, read through services: the task, and each
 * of its shifts with its own roster and invitations. Unguarded: the two remotes
 * that serve it (`getStaffShiftPage`, `getProjectTaskPage`) each guard first,
 * by different rules, and then call this. `null` when there is no such task.
 */
export async function loadWorkOrderView(id: string) {
	const [detail, row] = await Promise.all([getShiftDetail(id), getWorkOrderById(id)]);
	if (!detail || !row) return null;
	const [shiftRows, cancelledByName, feedback, tasks, engagements, reports, hours, assignees] =
		await Promise.all([
			listTaskShifts(id),
			detail.cancelledAt ? getShiftCancelledByName(id) : Promise.resolve(null),
			listFeedbackForWorkOrder(id),
			listWorkTasks(id),
			listJobs({ workOrderId: id }),
			listFlagsForWorkOrder(id),
			listHourLogs({ workOrderId: id }, { page: 1, pageSize: 100 }),
			listWorkOrderAssignees(id)
		]);
	const shifts = await Promise.all(
		shiftRows.map(async (shift) => {
			// Neither an invitation nor a refusal holds a place, so they are apart.
			const [claimants, invitations] = await Promise.all([
				listClaimants(shift.id),
				listInvitationsForShift(shift.id)
			]);
			return { ...shift, claimants, invitations };
		})
	);
	return {
		// The task's own notes, not a shift's briefing: each shift carries its own.
		task: { ...detail, notes: row.notes, cancelledByName },
		shifts,
		assignees,
		feedback,
		tasks,
		engagements,
		reports,
		hours: hours.rows
	};
}

export type WorkOrderView = NonNullable<Awaited<ReturnType<typeof loadWorkOrderView>>>;
export type WorkOrderViewShift = WorkOrderView['shifts'][number];
