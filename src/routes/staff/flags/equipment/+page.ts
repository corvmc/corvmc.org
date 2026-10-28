import { redirect } from '@sveltejs/kit';

/** Reported problems are an Inventory queue, not moderation (#1840). */
export function load() {
	redirect(308, '/staff/inventory/problems');
}
