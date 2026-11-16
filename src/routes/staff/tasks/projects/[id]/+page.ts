import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Old links: the Budget tab became its own report page, and a `?task=` panel
 * became the task's own page (#2625).
 */
export const load: PageLoad = ({ url, params }) => {
	if (url.searchParams.get('tab') === 'budget') {
		redirect(308, `/staff/tasks/projects/${params.id}/budget`);
	}
	const task = url.searchParams.get('task');
	if (task) redirect(308, `/staff/tasks/${encodeURIComponent(task)}`);
};
