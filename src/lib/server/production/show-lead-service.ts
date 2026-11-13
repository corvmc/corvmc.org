import { and, asc, eq, gte, isNull, notInArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { production } from '#lib/server/db/schema/production.js';
import { domainEvents } from '#lib/server/event-bus/event-bus.js';
import { DomainError } from '#lib/server/domain-error.js';
import { captureException } from '#lib/server/sentry.js';
import { containsLiteral } from '#lib/server/db/like.js';
import { TERMINAL_PRODUCTION_STATUSES } from '#lib/production/status.js';
import { SEARCH_LIMIT } from '#lib/config.js';
import { getProduction, updateProductionDetails } from './production-service';

/**
 * One person named as a show's event lead (#2726). The column is
 * `production.producer_user_id`; naming somebody there gives them
 * `production.run` on the show's project (see `leadsProject`).
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
