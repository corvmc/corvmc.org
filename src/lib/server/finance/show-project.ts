import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import { production } from '$lib/server/db/schema/production';

/**
 * The project a show's money counts toward: the project its production
 * specialises (docs/specs/production-projects-spec.md). Null for a listing that
 * announces no production — a band's gig, a community night — whose money is
 * nobody's project burn.
 */
export async function showProjectIdForEvent(eventId: string | null): Promise<string | null> {
	if (!eventId) return null;
	const [row] = await db
		.select({ projectId: production.projectId })
		.from(eventListing)
		.innerJoin(production, eq(production.id, eventListing.productionId))
		.where(eq(eventListing.id, eventId))
		.limit(1);
	return row?.projectId ?? null;
}

export async function showProjectIdForProduction(productionId: string): Promise<string | null> {
	const [row] = await db
		.select({ projectId: production.projectId })
		.from(production)
		.where(eq(production.id, productionId))
		.limit(1);
	return row?.projectId ?? null;
}
