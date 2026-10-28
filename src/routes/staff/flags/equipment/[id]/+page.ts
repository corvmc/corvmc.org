import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Reported problems are an Inventory queue, not moderation (#1840). */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/staff/inventory/problems/${params.id}`);
};
