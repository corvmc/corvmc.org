import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import { production } from '$lib/server/db/schema/production';
import { listAuditFeed, type AuditSubjectFilter } from '$lib/server/audit/audit-service';
import type { FeedPage } from '$lib/types/activity';

/**
 * Whose entries an event's History reads: the listing's own, and its show's.
 * A production is audited under its own id and reached through the listing's
 * project, which is also how `projectOfEvent` finds it.
 */
export function eventHistorySubjects(eventId: string): AuditSubjectFilter[] {
	const shows = db
		.select({ id: production.id })
		.from(production)
		.innerJoin(eventListing, eq(eventListing.projectId, production.projectId))
		.where(eq(eventListing.id, eventId));
	return [
		{ type: 'event', id: eventId },
		{ type: 'production', ids: shows }
	];
}

export function listEventHistory(
	eventId: string,
	opts: { limit?: number } = {}
): Promise<FeedPage> {
	return listAuditFeed(eventHistorySubjects(eventId), opts);
}
