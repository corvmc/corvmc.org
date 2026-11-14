import { redirect } from '@sveltejs/kit';
import { eventViewPath } from '../events/views';

// Productions is a view on Events (#2766).
export function load({ url }) {
	redirect(308, eventViewPath('productions', url.search));
}
