import { redirect } from '@sveltejs/kit';
import { memberViewRedirect } from '../members/views';

// Instructors are the Members list's teacher role (#2074, #2765).
export function load({ url }) {
	redirect(308, memberViewRedirect('teacher', url.search));
}
