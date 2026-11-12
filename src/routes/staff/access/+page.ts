import { redirect } from '@sveltejs/kit';

// Access is a tab on Settings (#2624).
export function load() {
	redirect(308, '/staff/settings?tab=access');
}
