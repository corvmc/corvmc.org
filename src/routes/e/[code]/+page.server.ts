import { error, redirect } from '@sveltejs/kit';
import { eventIdByShortCode } from '#lib/server/event/short-link.js';
import { requireListingVisible } from '#lib/server/event/listing-viewer.js';
import type { PageServerLoad } from './$types';

/**
 * Where a poster's `corvmc.org/e/<code>` lands: the event's public page. A
 * `load` rather than a remote function, as `/a/[tag]` and `/m/[memberNumber]`
 * are, so a phone camera gets a 302 off the server. A listing the viewer may
 * not see 404s here too, so the redirect does not hand out its id.
 */
export const load: PageServerLoad = async ({ params }) => {
	const id = await eventIdByShortCode(params.code);
	if (!id) error(404, 'Event not found');
	await requireListingVisible(id);
	redirect(302, `/events/${id}`);
};
