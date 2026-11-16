import { redirect } from '@sveltejs/kit';
import { groupViewRedirect } from '../groups/views';

// Bands, Clubs and Committees are kinds on the Groups list (#2086, #2765).
export function load({ url }) {
	redirect(308, groupViewRedirect('club', url.search));
}
