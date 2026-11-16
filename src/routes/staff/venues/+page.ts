import { redirect } from '@sveltejs/kit';
import { eventViewPath } from '../events/views';

// Venues is a view on Events (#2766); a venue's own page stays here.
export function load({ url }) {
	redirect(308, eventViewPath('venues', url.search));
}
