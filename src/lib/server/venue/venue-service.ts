import { db } from '$lib/server/db';
import { venue } from '$lib/server/db/schema/venue';
import { event } from '$lib/server/db/schema/event';
import { asc, count, eq, isNull } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { generateSlug, ensureUniqueSlug } from '$lib/server/utils/slug';
import type { Venue } from '$lib/server/db/schema/venue';

/**
 * Where a show is.
 *
 * Thin, like `contractor-service`: a venue is a name, an address and a way to
 * reach somebody. The one piece of behaviour that is not CRUD is `isPrimary`,
 * because exactly one row may carry it and moving it has to be one act rather
 * than an unset followed by a set — a half-applied move leaves the collective
 * with no room.
 */

export class VenueNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Venue not found');
	}
}

export class VenueInUseError extends DomainError {
	readonly httpStatus = 409;
	constructor(count: number) {
		super(
			`${count} ${count === 1 ? 'event names' : 'events name'} this venue. Archive it instead — the events keep their own record of where they were.`
		);
	}
}

export class PrimaryVenueError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
	}
}

export interface VenueInput {
	name: string;
	address1?: string | null;
	city?: string | null;
	state?: string | null;
	postalCode?: string | null;
	capacity?: number | null;
	contactName?: string | null;
	contactEmail?: string | null;
	contactPhone?: string | null;
	loadInNotes?: string | null;
	notes?: string | null;
}

export async function createVenue(data: VenueInput): Promise<Venue> {
	const slug = await ensureUniqueSlug(generateSlug(data.name), venue, venue.slug);
	const [row] = await db
		.insert(venue)
		.values({ ...data, slug })
		.returning();
	return row;
}

export async function updateVenue(id: string, data: Partial<VenueInput>): Promise<Venue> {
	const existing = await getVenue(id);

	// Re-slug only when the name actually moved, and exclude the row's own slug
	// so an ordinary save does not rotate 'the-practice-room' to '-2' and break
	// every inbound link.
	const slug =
		data.name !== undefined && data.name !== existing.name
			? await ensureUniqueSlug(generateSlug(data.name), venue, venue.slug, {
					column: venue.id,
					value: id
				})
			: undefined;

	const [row] = await db
		.update(venue)
		.set({ ...data, ...(slug ? { slug } : {}), updatedAt: new Date() })
		.where(eq(venue.id, id))
		.returning();

	return row;
}

/**
 * Move the primary flag, in one statement per side.
 *
 * The unique partial index means the clear has to land before the set, or the
 * second write trips it. No `db.transaction()` — D1 has none — so this is a
 * `db.batch`, which is atomic where it matters.
 */
export async function setPrimaryVenue(id: string): Promise<void> {
	const target = await getVenue(id);
	if (target.deletedAt) {
		throw new PrimaryVenueError('That venue is archived. Restore it before making it the room.');
	}
	if (target.isPrimary) return;

	await db.batch([
		db
			.update(venue)
			.set({ isPrimary: false, updatedAt: new Date() })
			.where(eq(venue.isPrimary, true)),
		db.update(venue).set({ isPrimary: true, updatedAt: new Date() }).where(eq(venue.id, id))
	]);
}

/**
 * Archive rather than delete, once anything points at it.
 *
 * An event keeps its own `location` text, so the show's record survives either
 * way — but a venue with history is a venue somebody will look up.
 */
export async function archiveVenue(id: string): Promise<void> {
	const target = await getVenue(id);
	if (target.isPrimary) {
		throw new PrimaryVenueError(
			'The practice room cannot be archived. Make another venue the room first.'
		);
	}
	await db
		.update(venue)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(eq(venue.id, id));
}

export async function restoreVenue(id: string): Promise<void> {
	await getVenue(id);
	await db.update(venue).set({ deletedAt: null, updatedAt: new Date() }).where(eq(venue.id, id));
}

/** Only for a row that should never have existed. Refused once an event names it. */
export async function deleteVenue(id: string): Promise<void> {
	const target = await getVenue(id);
	if (target.isPrimary) {
		throw new PrimaryVenueError('The practice room cannot be deleted.');
	}

	const [used] = await db.select({ n: count() }).from(event).where(eq(event.venueId, id));
	const n = Number(used?.n ?? 0);
	if (n > 0) throw new VenueInUseError(n);

	await db.delete(venue).where(eq(venue.id, id));
}

export async function getVenue(id: string): Promise<Venue> {
	const [row] = await db.select().from(venue).where(eq(venue.id, id)).limit(1);
	if (!row) throw new VenueNotFoundError();
	return row;
}

export async function getVenueBySlug(slug: string): Promise<Venue | null> {
	const [row] = await db.select().from(venue).where(eq(venue.slug, slug)).limit(1);
	return row ?? null;
}

/** The practice room, or null before anybody has said which one it is. */
export async function getPrimaryVenue(): Promise<Venue | null> {
	const [row] = await db.select().from(venue).where(eq(venue.isPrimary, true)).limit(1);
	return row ?? null;
}

export interface VenueWithUse extends Venue {
	/** How many events name it — the number that decides archive versus delete. */
	eventCount: number;
}

export async function listVenues({
	includeArchived = false
}: { includeArchived?: boolean } = {}): Promise<VenueWithUse[]> {
	const rows = await db
		.select({
			v: venue,
			eventCount: count(event.id)
		})
		.from(venue)
		.leftJoin(event, eq(event.venueId, venue.id))
		.where(includeArchived ? undefined : isNull(venue.deletedAt))
		.groupBy(venue.id)
		// The room first, then alphabetically. A list whose first row is the place
		// most shows are in is the list a producer wants.
		.orderBy(asc(venue.name));

	return rows
		.map((r) => ({ ...r.v, eventCount: Number(r.eventCount ?? 0) }))
		.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

/**
 * Does an event at this venue hold the practice space?
 *
 * The one question this table exists to answer. No venue at all means "assume
 * the room", which is what every event created before this table did and what
 * the create form still means when the field is left blank.
 */
export async function holdsSpace(venueId: string | null | undefined): Promise<boolean> {
	if (!venueId) return true;
	const [row] = await db
		.select({ isPrimary: venue.isPrimary })
		.from(venue)
		.where(eq(venue.id, venueId))
		.limit(1);
	return row?.isPrimary ?? true;
}
