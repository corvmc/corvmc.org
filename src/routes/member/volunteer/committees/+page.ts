import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Committee applications moved to Groups (#2113). `?committee=<slug>` carries
 * across, so the apply dialog for that committee opens.
 */
export const load: PageLoad = ({ url }) => {
	const committee = url.searchParams.get('committee');
	redirect(
		308,
		committee ? `/member/groups?${new URLSearchParams({ committee })}` : '/member/groups'
	);
};
