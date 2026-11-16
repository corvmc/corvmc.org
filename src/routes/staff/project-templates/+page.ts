import { redirect } from '@sveltejs/kit';

// Templates moved under Tasks (#2385, #2625).
export function load() {
	redirect(308, '/staff/tasks/templates');
}
