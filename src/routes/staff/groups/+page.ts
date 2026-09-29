import { redirect } from '@sveltejs/kit';

/**
 * Groups split into Clubs, under People, and Committees, under Planning
 * (production-projects-spec.md, the staff nav). Kept as a redirect because it
 * was the address of both for months.
 */
export function load() {
	redirect(308, '/staff/clubs');
}
