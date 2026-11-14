import { redirect } from '@sveltejs/kit';

// A list on Equipment (#2767). Records stay at /staff/inventory/acquisitions/[id].
export function load({ url }) {
	redirect(308, `/staff/inventory/acquisitions${url.search}`);
}
