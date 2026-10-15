import { redirect } from '@sveltejs/kit';

/** Closures are rows of the Reservations list now (#1833), filtered here to only them. */
export function load() {
	redirect(308, '/staff/reservations?show=closures');
}
