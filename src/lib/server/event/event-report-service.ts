import { db } from '$lib/server/db';
import { eventListing, eventKinds, type EventKind } from '$lib/server/db/schema/event';
import { and, count, eq } from 'drizzle-orm';
import { rangeCondition, type ReportRange } from '$lib/server/report/range';
import type { EventSource } from '$lib/config';

/**
 * What the calendar did over a window, for the annual rollup.
 *
 * Counts only, and deliberately no attendance figure: tickets cover the
 * minority of shows that are ticketed and RSVPs are opt-in, so either would
 * read as "people through the door" while being a fraction of it.
 */

export interface EventTotals {
	/** Published CMC events that started in the range, by kind. */
	cmcByKind: Record<EventKind, number>;
	cmcTotal: number;
	/** Listings the guide carried that CMC did not author. */
	bandListings: number;
	communityListings: number;
	/** Announced, then called off. Not counted as held. */
	cancelled: number;
}

const startedIn = (range: ReportRange) => rangeCondition(eventListing.startsAt, range);

async function countBySource(source: EventSource, range: ReportRange): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(eventListing)
		.where(
			and(eq(eventListing.source, source), eq(eventListing.status, 'published'), startedIn(range))
		);
	return row?.total ?? 0;
}

export async function getEventTotals(range: ReportRange = {}): Promise<EventTotals> {
	const [byKind, bandListings, communityListings, groupListings, cancelledRow] = await Promise.all([
		db
			.select({ kind: eventListing.kind, total: count() })
			.from(eventListing)
			.where(
				and(eq(eventListing.source, 'cmc'), eq(eventListing.status, 'published'), startedIn(range))
			)
			.groupBy(eventListing.kind),
		countBySource('band', range),
		countBySource('community', range),
		countBySource('group', range),
		db
			.select({ total: count() })
			.from(eventListing)
			.where(and(eq(eventListing.status, 'cancelled'), startedIn(range)))
	]);

	const cmcByKind = Object.fromEntries(eventKinds.map((k) => [k, 0])) as Record<EventKind, number>;
	for (const row of byKind) cmcByKind[row.kind] = row.total;

	return {
		cmcByKind,
		cmcTotal: Object.values(cmcByKind).reduce((a, b) => a + b, 0),
		bandListings,
		// A club or committee session is the members' own programming, not an
		// outside listing, so it counts with community rather than against CMC.
		communityListings: communityListings + groupListings,
		cancelled: cancelledRow[0]?.total ?? 0
	};
}
