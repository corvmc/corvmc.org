import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { userHasCapability } from '#lib/server/authorization.js';
import { canSeeListing, type ListingViewer } from './visibility';

/**
 * The caller as `visibleTo` reads them: the public, a member, or staff who read
 * every listing. `event.read` widens what a reader sees and refuses no one, so
 * it is asked by user rather than through `can`, which the listing-guard spec
 * reads as a staff gate.
 */
export async function currentListingViewer(): Promise<ListingViewer> {
	const { locals } = getRequestEvent();
	if (!locals.user) return null;
	return {
		userId: locals.user.id,
		seesAll: await userHasCapability(locals.user.id, 'event.read')
	};
}

/** 404 unless the caller may see the listing, so a hidden one is not revealed. */
export async function requireListingVisible(eventId: string): Promise<ListingViewer> {
	const viewer = await currentListingViewer();
	if (!(await canSeeListing(eventId, viewer))) error(404, 'Event not found');
	return viewer;
}
