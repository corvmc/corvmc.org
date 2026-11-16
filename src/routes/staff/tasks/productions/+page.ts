import { redirect } from '@sveltejs/kit';
import { productionsPath } from '../../productions/path';

// Productions, after Projects (#2101), Tasks (#2625) and Events (#2766, #3112).
export function load({ url }) {
	redirect(308, productionsPath(url.search, '/staff/tasks/productions'));
}
