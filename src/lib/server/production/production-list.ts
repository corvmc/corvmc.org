import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { production, type ProductionStatus } from '#lib/server/db/schema/production.js';
import { project } from '#lib/server/db/schema/project.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { venue } from '#lib/server/db/schema/venue.js';
import { paginate, type PaginationInput } from '#lib/server/db/paginate.js';

/** A bill short of the act count its production asks for (#859). A null target never matches. */
const shortOfActs = sql`${production.actsWanted} > (SELECT count(*) FROM "event_band" "eb"
	WHERE "eb"."event_id" = ${eventListing.id})`;

/**
 * The staff Productions list (#3112): every production, listed or not. A
 * production made from Tasks has a project and no listing until one is added.
 * The listing joins through the project, 1:1 like `listAll`'s join, so the
 * count can carry the same joins without fanning out.
 */
export async function listProductions(
	opts: { status?: ProductionStatus; needsActs?: boolean } = {},
	pagination: PaginationInput = {}
) {
	const where = and(
		opts.status ? eq(production.status, opts.status) : undefined,
		opts.needsActs ? shortOfActs : undefined
	);
	const when = sql`coalesce(${eventListing.startsAt}, ${project.startsAt})`;

	const dataQ = db
		.select({
			id: production.id,
			status: production.status,
			projectId: project.id,
			name: project.name,
			startsAt: project.startsAt,
			venueName: venue.name,
			listing: {
				id: eventListing.id,
				title: eventListing.title,
				status: eventListing.status,
				startsAt: eventListing.startsAt,
				endsAt: eventListing.endsAt
			}
		})
		.from(production)
		.innerJoin(project, eq(project.id, production.projectId))
		.leftJoin(eventListing, eq(eventListing.projectId, production.projectId))
		.leftJoin(venue, eq(venue.id, eventListing.venueId))
		.where(where)
		// Undated last; `id` breaks a tie so a page keeps its order.
		.orderBy(sql`${when} IS NULL`, desc(when), asc(production.id))
		.$dynamic();
	const countQ = db
		.select({ count: count() })
		.from(production)
		.innerJoin(project, eq(project.id, production.projectId))
		.leftJoin(eventListing, eq(eventListing.projectId, production.projectId))
		.where(where);
	return paginate(dataQ, countQ, pagination);
}
