import { redirect } from '@sveltejs/kit';

/** The dashboard folded into the Schedule (#2379); its cards are the Schedule's filters. */
export function load() {
	redirect(308, '/staff/volunteer/schedule');
}
