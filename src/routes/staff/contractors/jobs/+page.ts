import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * The jobs list is the Tasks table's contractor filter (#2069, #2625). An old
 * `?view=awaiting-invoice` link lands on that chip; the other views are rows
 * of the same filter.
 */
export const load: PageLoad = ({ url }) => {
	const invoice = url.searchParams.get('view') === 'awaiting-invoice';
	redirect(308, `/staff/tasks?kind=contractor${invoice ? '&chip=invoice' : ''}`);
};
