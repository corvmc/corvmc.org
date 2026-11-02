import { redirect } from '@sveltejs/kit';

/** Restock is the Inventory list's at-or-below-reorder-point view now (#2021). */
export function load() {
	redirect(308, '/staff/inventory?show=restock');
}
