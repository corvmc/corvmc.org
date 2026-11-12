import { redirect } from '@sveltejs/kit';
import { projectsTarget } from '../projects-target';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params, url }) => {
	redirect(308, projectsTarget(params.rest, url.search));
};
