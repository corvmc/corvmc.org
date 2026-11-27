import { and, asc, eq, gte, isNull, notInArray } from 'drizzle-orm';
import { volunteerRole, workOrder, workOrderAssignee } from '#lib/server/db/schema/volunteer.js';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { production } from '#lib/server/db/schema/production.js';
import { TERMINAL_PRODUCTION_STATUSES } from '#lib/production/status.js';
import { EVENT_LEAD_VOLUNTEER_ROLE, SEARCH_LIMIT } from '#lib/config.js';

/**
 * A show's event lead (#2726, #3274): the assignee on the show's "Event lead"
 * task, a volunteer role with no shift that carries `production.run` and
 * `event.manageGuests` through `volunteer_role_capability` (see
 * `roleGrantAllowsOnProject`). It replaced `production.producer_user_id`; the
 * migration that dropped the column made each producer the assignee.
 */

/** A show stays on its lead's list until this long after it starts. */
const LED_SHOW_GRACE_MS = 12 * 3_600_000;

export interface LedShow {
	productionId: string;
	eventId: string;
	title: string;
	startsAt: Date;
}

/** The open shows this person leads that have not long started, soonest first. */
export async function listShowsLedBy(userId: string, now = new Date()): Promise<LedShow[]> {
	return db
		.select({
			productionId: production.id,
			eventId: eventListing.id,
			title: eventListing.title,
			startsAt: eventListing.startsAt
		})
		.from(workOrderAssignee)
		.innerJoin(workOrder, eq(workOrder.id, workOrderAssignee.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.innerJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.innerJoin(production, eq(production.projectId, eventListing.projectId))
		.where(
			and(
				eq(workOrderAssignee.userId, userId),
				eq(volunteerRole.name, EVENT_LEAD_VOLUNTEER_ROLE),
				isNull(workOrder.cancelledAt),
				notInArray(production.status, [...TERMINAL_PRODUCTION_STATUSES]),
				gte(eventListing.startsAt, new Date(now.getTime() - LED_SHOW_GRACE_MS))
			)
		)
		.orderBy(asc(eventListing.startsAt))
		.limit(SEARCH_LIMIT);
}

const LEAD_TASK_NOTES =
	"Works with the acts before the show: answers their questions and keeps each act's guest list. The Production tab has the advance.";

/** The "Event lead" volunteer role, or null when staff have not created it. */
export async function leadRoleId(): Promise<string | null> {
	const [row] = await db
		.select({ id: volunteerRole.id })
		.from(volunteerRole)
		.where(eq(volunteerRole.name, EVENT_LEAD_VOLUNTEER_ROLE))
		.limit(1);
	return row?.id ?? null;
}

/** The show's live lead task, earliest first when a race made two. */
async function liveLeadTaskId(eventId: string, roleId: string): Promise<string | null> {
	const [row] = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(
			and(
				eq(workOrder.eventId, eventId),
				eq(workOrder.volunteerRoleId, roleId),
				isNull(workOrder.cancelledAt)
			)
		)
		.orderBy(asc(workOrder.createdAt), asc(workOrder.id))
		.limit(1);
	return row?.id ?? null;
}

/**
 * The show's event lead task, created if it is not there yet. Null when the
 * "Event lead" role does not exist: the Crew box says so and the show is
 * unaffected. Two callers at once may each insert one; both read back the
 * earliest, so they agree on which is the lead's.
 */
export async function ensureLeadTask(eventId: string): Promise<string | null> {
	const roleId = await leadRoleId();
	if (!roleId) return null;
	const existing = await liveLeadTaskId(eventId, roleId);
	if (existing) return existing;
	await db.insert(workOrder).values({
		volunteerRoleId: roleId,
		eventId,
		title: EVENT_LEAD_VOLUNTEER_ROLE,
		notes: LEAD_TASK_NOTES
	});
	return liveLeadTaskId(eventId, roleId);
}

export interface ShowLeadTask {
	workOrderId: string;
	/** Everyone assigned; one in practice. */
	people: { userId: string; name: string }[];
}

/** The show's lead task and who holds it, or null when no task exists. */
export async function getShowLead(eventId: string): Promise<ShowLeadTask | null> {
	const roleId = await leadRoleId();
	if (!roleId) return null;
	const workOrderId = await liveLeadTaskId(eventId, roleId);
	if (!workOrderId) return null;
	const people = await db
		.select({ userId: user.id, name: user.name })
		.from(workOrderAssignee)
		.innerJoin(user, eq(user.id, workOrderAssignee.userId))
		.where(and(eq(workOrderAssignee.workOrderId, workOrderId), isNull(user.deletedAt)))
		.orderBy(asc(workOrderAssignee.assignedAt), asc(user.id));
	return { workOrderId, people };
}
