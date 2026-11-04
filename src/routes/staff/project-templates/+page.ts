import { redirect } from '@sveltejs/kit';

// Templates moved under Projects (#2385).
export function load() {
	redirect(308, '/staff/projects/templates');
}
