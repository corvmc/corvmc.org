import { redirect } from '@sveltejs/kit';

// Duty lists became Project Templates, under Planning (#2034).
export function load() {
	redirect(308, '/staff/project-templates');
}
