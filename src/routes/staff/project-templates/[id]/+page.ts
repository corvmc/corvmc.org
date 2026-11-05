import { redirect } from '@sveltejs/kit';

// Templates moved under Projects (#2385).
export function load({ params }) {
	redirect(308, `/staff/projects/templates/${params.id}`);
}
