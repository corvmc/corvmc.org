import { error, redirect } from '@sveltejs/kit';
import { eventIdByShortCode } from '#lib/server/event/short-link.js';
import type { PageServerLoad } from './$types';

/**
 * Where a poster's `corvmc.org/e/<code>` lands: the event's public page. A
 * `load` rather than a remote function, as `/a/[tag]` and `/m/[memberNumber]`
 * are, so a phone camera gets a 302 off the server. The event page applies its
 * own visibility rules, so this route checks none.
 */
export const load: PageServerLoad = async ({ params }) => {
	const id = await eventIdByShortCode(params.code);
	if (!id) error(404, 'Event not found');
	redirect(302, `/events/${id}`);
};
