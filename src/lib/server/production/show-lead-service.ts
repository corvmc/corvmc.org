import { and, asc, eq, gte, isNull, notInArray } from 'drizzle-orm';
import { volunteerRole, workOrder, workOrderAssignee } from '#lib/server/db/schema/volunteer.js';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { production } from '#lib/server/db/schema/production.js';
import { domainEvents } from '#lib/server/event-bus/event-bus.js';
import { DomainError } from '#lib/server/domain-error.js';
import { captureException } from '#lib/server/sentry.js';
import { containsLiteral } from '#lib/server/db/like.js';
import { TERMINAL_PRODUCTION_STATUSES } from '#lib/production/status.js';
import { EVENT_LEAD_VOLUNTEER_ROLE, SEARCH_LIMIT } from '#lib/config.js';
import { getProduction, updateProductionDetails } from './production-service';

/**
 * A show's event lead (#2726, #3274). Two things name one, side by side until
 * `production.producer_user_id` retires: that column, which gives
 * `production.run` on the show's project (see `leadsProject`), and an
 * assignee on the show's "Event lead" task, a volunteer role with no shift
 * that carries `production.run` and `event.manageGuests` through
 * `volunteer_role_capability` (see `roleGrantAllowsOnProject`).
 */

/** 422: the lead has to be a live account. */
export class ShowLeadNotFoundError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('That person has no active account.');
		this.name = 'ShowLeadNotFoundError';
	}
}

/** A show stays on its lead's list until this long after it starts. */
const LED_SHOW_GRACE_MS = 12 * 3_600_000;

/**
 * Name the event lead, or clear it with `null`. The new lead hears about it
 * unless they named themselves or already held it.
 */
export async function setShowLead(
	productionId: string,
	leadUserId: string | null,
	actorUserId: string | null
): Promise<void> {
	const before = await getProduction(productionId);
	const lead = leadUserId ? await liveUser(leadUserId) : null;
	if (leadUserId && !lead) throw new ShowLeadNotFoundError();
	await updateProductionDetails(productionId, { producerUserId: leadUserId });
	if (!lead || lead.id === before.producerUserId || lead.id === actorUserId) return;
	await announceLead(productionId, lead, actorUserId);
}

async function liveUser(id: string) {
	const [row] = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(and(eq(user.id, id), isNull(user.deletedAt)))
		.limit(1);
	return row ?? null;
}

/** Captured rather than thrown: the lead is already saved. */
async function announceLead(
	productionId: string,
	lead: { id: string; name: string; email: string },
	actorUserId: string | null
): Promise<void> {
	try {
		const [[show], actor] = await Promise.all([
			db
				.select({
					eventId: eventListing.id,
					title: eventListing.title,
					startsAt: eventListing.startsAt
				})
				.from(production)
				.innerJoin(eventListing, eq(eventListing.projectId, production.projectId))
				.where(eq(production.id, productionId))
				.limit(1),
			actorUserId ? liveUser(actorUserId) : Promise.resolve(null)
		]);
		if (!show) return;
		await domainEvents.emit('production.lead_assigned', {
			productionId,
			eventId: show.eventId,
			eventTitle: show.title,
			startsAt: show.startsAt.toISOString(),
			leadUserId: lead.id,
			leadName: lead.name,
			leadEmail: lead.email,
			assignedByName: actor?.name ?? null
		});
	} catch (err) {
		captureException(err, { event: 'production.lead_assigned', productionId });
	}
}

/** Members a show's booker can name as its lead, by name. No emails: a booker is not staff. */
export async function searchLeadCandidates(q: string): Promise<{ id: string; name: string }[]> {
	if (q.trim().length < 2) return [];
	return db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(and(containsLiteral(user.name, q.trim()), isNull(user.deletedAt)))
		.orderBy(asc(user.name))
		.limit(SEARCH_LIMIT);
}

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
		.from(production)
		.innerJoin(eventListing, eq(eventListing.projectId, production.projectId))
		.where(
			and(
				eq(production.producerUserId, userId),
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
