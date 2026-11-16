import { redirect } from '@sveltejs/kit';
import { memberViewRedirect } from '../../members/views';

// People became the Members list's volunteer role (#2074, #2765). `?tab=signoff`
// is the retired sign-off tab, which is the blocked status now.
export function load({ url }) {
	const search = url.searchParams.get('tab') === 'signoff' ? signoff(url.search) : url.search;
	redirect(308, memberViewRedirect('volunteer', search));
}

function signoff(search: string): string {
	const kept = [...new URLSearchParams(search)].filter(([k]) => k !== 'tab' && k !== 'status');
	return [...kept, ['status', 'blocked']]
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join('&');
}
