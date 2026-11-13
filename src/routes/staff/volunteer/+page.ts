import { redirect } from '@sveltejs/kit';

/** The dashboard folded into the Schedule (#2379), whose shifts are Volunteering now (#2625). */
export function load() {
	redirect(308, '/staff/volunteering');
}
