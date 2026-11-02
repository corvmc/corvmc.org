import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarSource } from '$lib/server/db/schema/calendar-source';
import { DomainError } from '$lib/server/domain-error';
import { runPartnerImports, type SourceRunResult } from '$lib/server/event/partner-import-service';

/**
 * A venue's partner feeds: add, pause, remove, fetch now. Removing one keeps
 * the listings it already imported; their `import_source_id` goes null and
 * nothing updates them again.
 */

export class CalendarSourceNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Feed not found');
	}
}

export class CalendarSourceExistsError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('That feed is already added');
	}
}

export interface CalendarSourceSummary {
	id: string;
	url: string;
	paused: boolean;
	lastFetchedAt: Date | null;
	lastError: string | null;
	lastImportedCount: number | null;
}

/** `webcal:` is how calendar sites advertise a subscription; it is fetched as https. */
export function normalizeFeedUrl(url: string): string {
	return url.trim().replace(/^webcal:/i, 'https:');
}

export async function listSourcesForVenue(venueId: string): Promise<CalendarSourceSummary[]> {
	return db
		.select({
			id: calendarSource.id,
			url: calendarSource.url,
			paused: calendarSource.paused,
			lastFetchedAt: calendarSource.lastFetchedAt,
			lastError: calendarSource.lastError,
			lastImportedCount: calendarSource.lastImportedCount
		})
		.from(calendarSource)
		.where(eq(calendarSource.venueId, venueId))
		.orderBy(asc(calendarSource.createdAt), asc(calendarSource.id));
}

export async function addSource(params: {
	venueId: string;
	url: string;
	createdByUserId: string;
}): Promise<{ id: string; venueId: string }> {
	const url = normalizeFeedUrl(params.url);
	const [existing] = await db
		.select({ id: calendarSource.id })
		.from(calendarSource)
		.where(eq(calendarSource.url, url))
		.limit(1);
	if (existing) throw new CalendarSourceExistsError();

	const [row] = await db
		.insert(calendarSource)
		.values({ venueId: params.venueId, url, createdByUserId: params.createdByUserId })
		.returning({ id: calendarSource.id, venueId: calendarSource.venueId });
	return row;
}

async function requireSource(id: string): Promise<{ id: string; venueId: string }> {
	const [row] = await db
		.select({ id: calendarSource.id, venueId: calendarSource.venueId })
		.from(calendarSource)
		.where(eq(calendarSource.id, id))
		.limit(1);
	if (!row) throw new CalendarSourceNotFoundError();
	return row;
}

export async function setSourcePaused(id: string, paused: boolean): Promise<{ venueId: string }> {
	const row = await requireSource(id);
	await db
		.update(calendarSource)
		.set({ paused, updatedAt: new Date() })
		.where(eq(calendarSource.id, id));
	return row;
}

export async function removeSource(id: string): Promise<{ venueId: string }> {
	const row = await requireSource(id);
	await db.delete(calendarSource).where(eq(calendarSource.id, id));
	return row;
}

/** Run one feed now, paused or not, so staff see a new feed work before tomorrow's run. */
export async function fetchSourceNow(
	id: string
): Promise<{ venueId: string; result: SourceRunResult }> {
	const row = await requireSource(id);
	const [result] = await runPartnerImports({ sourceId: id });
	if (!result) throw new CalendarSourceNotFoundError();
	return { venueId: row.venueId, result };
}
