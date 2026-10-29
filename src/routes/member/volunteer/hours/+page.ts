import { redirect } from '@sveltejs/kit';

/** Volunteer hours live on the volunteer Profile page; old links land there. */
export function load() {
	redirect(308, '/member/volunteer/profile');
}
