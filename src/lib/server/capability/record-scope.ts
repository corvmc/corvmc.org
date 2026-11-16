import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import {
	maintenanceSchedule,
	volunteerShift,
	volunteerSignup,
	workOrder
} from '#lib/server/db/schema/volunteer.js';
import type { CapabilityScope } from '#lib/server/capability/grant-rules.js';

/**
 * The scope a guard passes for the row it acts on: the owning committee and the
 * project, read from the row and never from the request. A missing row is an
 * empty scope, so the guard admits only org-wide holders and the service 404s.
 */
const fromTask = { groupId: workOrder.groupId, projectId: workOrder.projectId };

export async function taskScope(workOrderId: string): Promise<CapabilityScope> {
	const [row] = await db.select(fromTask).from(workOrder).where(eq(workOrder.id, workOrderId));
	return row ?? {};
}

export async function shiftScope(shiftId: string): Promise<CapabilityScope> {
	const [row] = await db
		.select(fromTask)
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.where(eq(volunteerShift.id, shiftId));
	return row ?? {};
}

export async function signupScope(signupId: string): Promise<CapabilityScope> {
	const [row] = await db
		.select(fromTask)
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.where(eq(volunteerSignup.id, signupId));
	return row ?? {};
}

export async function scheduleScope(scheduleId: string): Promise<CapabilityScope> {
	const [row] = await db
		.select({ groupId: maintenanceSchedule.groupId, projectId: maintenanceSchedule.projectId })
		.from(maintenanceSchedule)
		.where(eq(maintenanceSchedule.id, scheduleId));
	return row ?? {};
}

export async function eventScope(eventId: string): Promise<CapabilityScope> {
	const [row] = await db
		.select({ projectId: eventListing.projectId })
		.from(eventListing)
		.where(eq(eventListing.id, eventId));
	return row ? { eventId, projectId: row.projectId } : {};
}
