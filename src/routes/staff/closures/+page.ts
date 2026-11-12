import { redirect } from '@sveltejs/kit';

/** Closures are rows of the Practice space list (#1833), under All bookers. */
export function load() {
	redirect(308, '/staff/reservations');
}
