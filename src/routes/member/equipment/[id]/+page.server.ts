import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * A member has no per-item page of its own — the catalog row is the catalog.
 *
 * The route exists because `entityHref` resolves an `equipment` ref to it for a
 * signed-in member, and a chip that links nowhere is worse than one that links
 * back to the list. Redirecting keeps the link honest without inventing a page
 * with nothing on it.
 */
export const load: PageServerLoad = async () => {
	redirect(302, '/member/equipment');
};
