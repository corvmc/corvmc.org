import { redirect } from '@sveltejs/kit';

/** Orders are an on-order view of the Supplies list now (#2022); an order's own page stays. */
export function load() {
	redirect(308, '/staff/inventory/supplies?show=on-order');
}
