import { redirect } from '@sveltejs/kit';

// A view on the Payments row (#2395).
export function load({ url }) {
	redirect(308, `/staff/money/credits${url.search}`);
}
