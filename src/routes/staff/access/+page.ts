import { redirect } from '@sveltejs/kit';

// Access is a System panel row (#2763).
export function load() {
	redirect(308, '/staff/system/access');
}
