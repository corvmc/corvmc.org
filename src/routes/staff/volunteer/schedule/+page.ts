import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Work with no shift and contractor work are Tasks' (#2625). A contractor link
 * asking for work awaiting an invoice lands on that chip.
 */
export const load: PageLoad = ({ url }) => {
	const kind = url.searchParams.get('kind');
	if (kind !== 'contractor' && kind !== 'untimed') return;
	const invoice =
		kind === 'contractor' && url.searchParams.get('contractor') === 'awaiting-invoice';
	redirect(308, `/staff/tasks?kind=${kind}${invoice ? '&chip=invoice' : ''}`);
};
