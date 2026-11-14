import { redirect } from '@sveltejs/kit';

// The audit log is a System panel row (#2763).
export function load({ url }) {
	redirect(308, `/staff/system/audit${url.search}`);
}
