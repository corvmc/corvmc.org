import { redirect } from '@sveltejs/kit';

// A view on Moderation (#2393). Records stay at /staff/incidents/[id].
export function load({ url }) {
	redirect(308, `/staff/moderation/incidents${url.search}`);
}
