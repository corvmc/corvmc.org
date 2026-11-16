import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Every task has one page now, in a project or not (#2625). Links and emails still name this one. */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/staff/tasks/${params.id}`);
};
