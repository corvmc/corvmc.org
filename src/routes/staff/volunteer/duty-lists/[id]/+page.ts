import { redirect } from '@sveltejs/kit';

// Duty lists became Project Templates, under Tasks (#2034, #2385, #2625).
export function load({ params }) {
	redirect(308, `/staff/tasks/templates/${params.id}`);
}
