import { redirect } from '@sveltejs/kit';

// People became the Members "Volunteers" view (#2074). `?tab=signoff` is the
// retired sign-off tab, which is the blocked status now.
export function load({ url }) {
	const params = new URLSearchParams(url.search);
	if (params.get('tab') === 'signoff') {
		params.delete('tab');
		params.set('status', 'blocked');
	}
	const query = params.toString();
	redirect(308, `/staff/members/volunteers${query ? `?${query}` : ''}`);
}
