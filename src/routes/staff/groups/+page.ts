import { redirect } from '@sveltejs/kit';

// Every group type has its own address; the bare one names none (#2381).
export function load({ url }) {
	redirect(308, `/staff/groups/bands${url.search}`);
}
