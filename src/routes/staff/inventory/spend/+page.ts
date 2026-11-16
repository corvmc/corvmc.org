import { redirect } from '@sveltejs/kit';

// A view on Reports (#2396).
export function load({ url }) {
	redirect(308, `/staff/reports/inventory-spend${url.search}`);
}
