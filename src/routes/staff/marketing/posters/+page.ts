import { redirect } from '@sveltejs/kit';

// The poster is a Print poster action on Events (#3112).
export function load({ url }) {
	redirect(308, `/staff/events/poster${url.search}`);
}
