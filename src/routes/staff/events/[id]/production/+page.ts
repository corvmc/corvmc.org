import { redirect } from '@sveltejs/kit';
import { eventTabHref } from '../tabs';

// The console is the event page's Production tab (#3270).
export function load({ params }) {
	redirect(308, eventTabHref(params.id, 'production'));
}
