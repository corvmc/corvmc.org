import { redirect } from '@sveltejs/kit';
import { groupViewPath } from '../groups/views';

// Bands, Clubs and Committees are kinds on the Groups list (#2086, #2765).
export function load({ url }) {
	redirect(308, groupViewPath('committee', url.search));
}
