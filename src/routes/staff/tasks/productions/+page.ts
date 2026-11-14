import { redirect } from '@sveltejs/kit';
import { eventViewPath } from '../../events/views';

// Productions is a view on Events (#2766), after Projects (#2101) and Tasks (#2625).
export function load({ url }) {
	redirect(308, eventViewPath('productions', url.search));
}
