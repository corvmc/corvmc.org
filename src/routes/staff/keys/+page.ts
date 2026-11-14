import { redirect } from '@sveltejs/kit';

// Key holders is part of Building access, a Practice space view (#2766).
export function load() {
	redirect(308, '/staff/building-access');
}
