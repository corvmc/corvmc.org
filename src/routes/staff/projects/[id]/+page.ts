import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// The Budget tab became its own report page; old links still land on it.
export const load: PageLoad = ({ url, params }) => {
	if (url.searchParams.get('tab') === 'budget') {
		redirect(308, `/staff/projects/${params.id}/budget`);
	}
};
