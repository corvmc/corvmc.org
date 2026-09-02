import { redirect } from '@sveltejs/kit';

/**
 * The shift catalog was folded into Schedule, whose "Everything" window is what
 * this page's Include-past checkbox used to be. The two asked the same query the
 * same question and drifted apart in the answer — only one of them grouped by
 * day, and the flat one had no marker for today.
 */
export function load() {
	redirect(308, '/staff/volunteer/schedule');
}
