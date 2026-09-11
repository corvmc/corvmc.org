import { eventBand } from '../../src/lib/server/db/schema/event';
import { artifactRequest } from '../../src/lib/server/db/schema/artifact-request';
import { production } from '../../src/lib/server/db/schema/production';
import { batchInsert, db } from './db';
import { asc, inArray, isNotNull, and } from 'drizzle-orm';

/**
 * What a show is still waiting on.
 *
 * Three states have to be reachable locally or the Advance panel is built
 * against one: arrived, waiting, and overdue. Arrival is derived from the
 * artifact, so "arrived" is seeded by asking an act that already has a rider
 * rather than by writing a flag.
 */
type ProductionRow = typeof production.$inferSelect;

export async function seedArtifactRequests(productions: ProductionRow[]) {
	// Every production, not just the confirmed ones: the panel is on the console
	// for a show at any stage, and an ask goes out before anything is confirmed.
	if (productions.length === 0) return { requests: 0 };

	const eventIds = productions.map((p) => p.eventId);
	const credits = await db
		.select({ eventId: eventBand.eventId, entryId: eventBand.directoryEntryId })
		.from(eventBand)
		.where(and(inArray(eventBand.eventId, eventIds), isNotNull(eventBand.directoryEntryId)))
		.orderBy(asc(eventBand.eventId), asc(eventBand.billingOrder));

	const day = 24 * 60 * 60 * 1000;
	const rows = credits.slice(0, 8).map((c, i) => ({
		eventId: c.eventId,
		entryId: c.entryId!,
		artifact: (i % 2 === 0 ? 'tech_rider' : 'epk') as 'tech_rider' | 'epk',
		// Every other ask is already past its date, so overdue renders too.
		dueAt: new Date(Date.now() + (i % 2 === 1 ? -2 : 10) * day)
	}));
	if (rows.length === 0) return { requests: 0 };

	await batchInsert(artifactRequest, rows);
	return { requests: rows.length };
}
