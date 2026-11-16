import { redirect } from '@sveltejs/kit';

/** Feature switches are code config now (#3117), so the page that toggled them is gone. */
export function load() {
	redirect(308, '/staff/system');
}
