import { redirect } from '@sveltejs/kit';

// Duty lists became Project Templates, under Projects (#2034, #2385).
export function load() {
	redirect(308, '/staff/projects/templates');
}
