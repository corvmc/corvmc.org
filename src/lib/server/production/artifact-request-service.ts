import { db } from '$lib/server/db';
import { artifactRequest } from '$lib/server/db/schema/artifact-request';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { eventBand } from '$lib/server/db/schema/event';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getEventRiderSummaries } from '$lib/server/band/rider-service';
import { listAttachedEntries } from '$lib/server/media/media-service';
import type { RequestableArtifact } from '$lib/config';
import type { OutstandingRequest } from '$lib/types/artifact-request';

export type { OutstandingRequest };

/**
 * Asking an act for something, and knowing whether it came.
 *
 * Arrival is derived, never stored — a rider filled in unprompted still counts,
 * and nothing has to be marked done by hand.
 */

export async function requestArtifact(input: {
	eventId: string;
	entryId: string;
	artifact: RequestableArtifact;
	dueAt?: Date | null;
	requestedByUserId?: string | null;
}): Promise<void> {
	// Asking again is a reminder rather than a second request, so a repeat
	// updates the deadline instead of adding a row the outstanding count would
	// then double.
	await db
		.insert(artifactRequest)
		.values({
			eventId: input.eventId,
			entryId: input.entryId,
			artifact: input.artifact,
			dueAt: input.dueAt ?? null,
			requestedByUserId: input.requestedByUserId ?? null
		})
		.onConflictDoUpdate({
			target: [artifactRequest.eventId, artifactRequest.entryId, artifactRequest.artifact],
			set: { dueAt: input.dueAt ?? null, requestedAt: new Date(), cancelledAt: null }
		});
}

export async function cancelArtifactRequest(id: string): Promise<void> {
	await db
		.update(artifactRequest)
		.set({ cancelledAt: new Date() })
		.where(eq(artifactRequest.id, id));
}

/**
 * What a show is still waiting on.
 *
 * A tech rider is the summary the Advance tab computes **or** a file on the
 * listing — `rider` is keyed on `group_id`, so for an act with no account the
 * summary is always empty and the file is the only answer (#863). A press kit
 * is a listing with a bio. Poster art is #608's and always reads unfulfilled.
 */
export async function listRequests(
	eventId: string,
	now = new Date()
): Promise<OutstandingRequest[]> {
	const rows = await db
		.select({
			id: artifactRequest.id,
			entryId: artifactRequest.entryId,
			artifact: artifactRequest.artifact,
			dueAt: artifactRequest.dueAt,
			requestedAt: artifactRequest.requestedAt,
			// The listing's own name, not the credit's copy of it: a request is
			// against the listing, and an artist commissioned for poster art has one
			// without ever being on the bill.
			actName: directoryEntry.name,
			bio: directoryEntry.bio
		})
		.from(artifactRequest)
		.innerJoin(directoryEntry, eq(directoryEntry.id, artifactRequest.entryId))
		.where(and(eq(artifactRequest.eventId, eventId), isNull(artifactRequest.cancelledAt)));

	if (rows.length === 0) return [];

	const wantsRider = rows.some((r) => r.artifact === 'tech_rider');

	// One read for every rider on the bill, rather than one per request, and one
	// more for the files — both are a single statement over the whole bill.
	const [riders, riderFiles] = await Promise.all([
		wantsRider ? getEventRiderSummaries(eventId) : Promise.resolve([]),
		wantsRider
			? listAttachedEntries(
					'directory_entry',
					rows.filter((r) => r.artifact === 'tech_rider').map((r) => r.entryId),
					'rider'
				)
			: Promise.resolve(new Set<string>())
	]);
	const riderArrived = new Map(riders.map((r) => [r.name, !r.empty]));

	return rows.map((r) => {
		const fulfilled =
			r.artifact === 'tech_rider'
				? (riderArrived.get(r.actName ?? '') ?? false) || riderFiles.has(r.entryId)
				: r.artifact === 'epk'
					? Boolean(r.bio && r.bio.trim().length > 0)
					: false;
		return {
			id: r.id,
			entryId: r.entryId,
			actName: r.actName,
			artifact: r.artifact,
			dueAt: r.dueAt,
			requestedAt: r.requestedAt,
			fulfilled,
			overdue: !fulfilled && r.dueAt !== null && r.dueAt < now
		};
	});
}

/** What is still owed across the whole bill — the number staff act on. */
export async function outstandingCount(eventId: string, now = new Date()): Promise<number> {
	return (await listRequests(eventId, now)).filter((r) => !r.fulfilled).length;
}

/**
 * Who a request can be sent to.
 *
 * Off `event_band` rather than `production_slot`: an act can be asked for its
 * rider before anyone opens a run of show, and a credit with no listing has
 * nowhere to receive one.
 */
export async function requestableActs(
	eventId: string
): Promise<{ entryId: string; name: string }[]> {
	const rows = await db
		.select({ entryId: eventBand.directoryEntryId, name: eventBand.name })
		.from(eventBand)
		.where(eq(eventBand.eventId, eventId))
		.orderBy(asc(eventBand.billingOrder));

	return rows
		.filter((r): r is { entryId: string; name: string } => r.entryId !== null)
		.map((r) => ({ entryId: r.entryId, name: r.name }));
}
