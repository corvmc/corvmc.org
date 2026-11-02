import { redirect } from '@sveltejs/kit';

/** Adding a show is a modal on the Events page now; old links land there. */
export function load() {
	redirect(308, '/member/events');
}
