import { redirect } from '@sveltejs/kit';

/** Needs tagging is a modal on Inventory now (#1937); `?tagging` opens it. */
export function load() {
	redirect(308, '/staff/inventory?tagging');
}
