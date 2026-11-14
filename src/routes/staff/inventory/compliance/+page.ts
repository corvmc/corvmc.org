import { redirect } from '@sveltejs/kit';

// The Form 8282 filter on Acquisitions (#2767).
export function load() {
	redirect(308, '/staff/inventory/acquisitions?show=form-8282');
}
