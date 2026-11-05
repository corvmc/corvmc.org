import { redirect } from '@sveltejs/kit';

// A view on Reports (#2396). Records stay at /staff/inventory/acquisitions/[id].
export function load({ url }) {
	redirect(308, `/staff/reports/acquisitions${url.search}`);
}
