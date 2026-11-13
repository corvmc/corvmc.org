import { error } from '@sveltejs/kit';
import { can, requireUser } from '#lib/server/authorization.js';
import { requireProgramRole, requireProjectCommittee } from '#lib/server/group/group-context.js';
import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { eq } from 'drizzle-orm';
import { projectOfEvent } from '#lib/server/production/production-scope.js';

/**
 * A write to a listing: `event.manage`, or a seat with `production.book` on a
 * committee taking part in the show's project. The project is read off the
 * listing, never off the request, and a listing with no production has no
 * committee to ask, so it takes `event.manage` alone.
 */
export async function requireListingWriter(eventId: string) {
	const user = requireUser();
	if (await can('event.manage')) return user;
	const show = await projectOfEvent(eventId);
	if (show?.productionId) {
		return (await requireProjectCommittee(show.projectId, 'production.book')).user;
	}
	throw error(403, 'Not permitted');
}

/**
 * A read of a listing: `event.read`, or anyone `requireListingWriter` admits.
 * The show's committee reads what it may write (#2002).
 */
export async function requireListingReader(eventId: string) {
	const user = requireUser();
	if (await can('event.read')) return user;
	return requireListingWriter(eventId);
}

/**
 * Who may change a series' schedule: `event.manage` as staff; for a program's
 * series, a leader of that program; otherwise whoever `requireListingWriter`
 * admits for the prototype.
 */
export async function requireSeriesWriter(prototypeEventId: string): Promise<'staff' | 'owner'> {
	requireUser();
	if (await can('event.manage')) return 'staff';
	const [listing] = await db
		.select({ source: eventListing.source, groupId: eventListing.groupId })
		.from(eventListing)
		.where(eq(eventListing.id, prototypeEventId))
		.limit(1);
	if (listing?.source === 'group' && listing.groupId) {
		await requireProgramRole({ id: listing.groupId }, 'admin');
		return 'owner';
	}
	await requireListingWriter(prototypeEventId);
	return 'owner';
}
