import { redirect } from '@sveltejs/kit';

/**
 * The shift catalog folded into the Schedule, whose "Everything" window was this
 * page's Include-past checkbox; its shifts are Volunteering now (#2625).
 */
export function load() {
	redirect(308, '/staff/volunteering');
}
