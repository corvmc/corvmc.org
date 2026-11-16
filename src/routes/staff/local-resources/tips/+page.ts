import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** A tip is a pending listing: the tips queue is that status filter (#2765). */
export const load: PageLoad = () => {
	redirect(308, '/staff/local-resources?status=pending');
};
