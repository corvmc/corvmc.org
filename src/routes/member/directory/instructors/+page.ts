import { redirect } from '@sveltejs/kit';

/**
 * Teachers became a member-directory filter (#2115). The logged-out landing
 * page is `/directory/instructors`, which stays.
 */
export function load() {
	redirect(308, '/member/directory?teaches=collective');
}
