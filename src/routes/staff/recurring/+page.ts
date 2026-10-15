import { redirect } from '@sveltejs/kit';

/** Recurring series are a modal on Reservations now (#1936); `?recurring` opens it. */
export function load() {
	redirect(308, '/staff/reservations?recurring');
}
