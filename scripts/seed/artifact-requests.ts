import { eventBand } from '../../src/lib/server/db/schema/event';
import { artifactRequest } from '../../src/lib/server/db/schema/artifact-request';
import { production } from '../../src/lib/server/db/schema/production';
import { directoryEntry } from '../../src/lib/server/db/schema/directory';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
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
type ProductionRow = typeof production.$inferSelect & { eventId: string };

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
	if (rows.length > 0) await batchInsert(artifactRequest, rows);
	const posters = await seedPosterCommissions(productions.map((p) => p.eventId));
	return { requests: rows.length + posters };
}

/**
 * An illustrator who is on no bill, asked for two shows' posters: one overdue
 * with nothing sent, so the template fallback has a reason to exist, and one
 * delivered and not yet promoted. The media key names no real object.
 */
async function seedPosterCommissions(eventIds: string[]): Promise<number> {
	const [overdueFor, deliveredFor] = eventIds;
	if (!overdueFor || !deliveredFor) return 0;

	const [artist] = await db
		.insert(directoryEntry)
		.values({ name: 'Maren Holt', hometown: 'Philomath, OR', visibility: 'hidden' })
		.returning({ id: directoryEntry.id });

	const day = 24 * 60 * 60 * 1000;
	const [, delivered] = await db
		.insert(artifactRequest)
		.values([
			{
				eventId: overdueFor,
				entryId: artist.id,
				artifact: 'poster_art',
				dueAt: new Date(Date.now() - 3 * day)
			},
			{
				eventId: deliveredFor,
				entryId: artist.id,
				artifact: 'poster_art',
				dueAt: new Date(Date.now() + 7 * day)
			}
		])
		.returning({ id: artifactRequest.id });

	const [art] = await db
		.insert(media)
		.values({
			key: `acts/poster-art/${delivered.id}-seed.png`,
			contentType: 'image/png',
			byteSize: 420_000,
			caption: 'Poster art by Maren Holt'
		})
		.returning({ id: media.id });
	await db.insert(mediaAttachment).values({
		mediaId: art.id,
		attachableType: 'artifact_request',
		attachableId: delivered.id,
		slot: 'poster'
	});
	return 2;
}
