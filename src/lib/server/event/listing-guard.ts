import { error } from '@sveltejs/kit';
import { can, requireUser } from '$lib/server/authorization';
import { requireProjectCommittee } from '$lib/server/group/group-context';
import { projectOfEvent } from '$lib/server/production/production-scope';

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
