import { redirect } from '@sveltejs/kit';
import { getShowTonight } from '#lib/server/event/event-service.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const show = await getShowTonight();
	if (show) throw redirect(302, `/events/${show.id}`);
	throw redirect(303, '/events?notice=no-show-tonight');
};
