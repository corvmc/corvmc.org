import { redirect } from '@sveltejs/kit';
import { eventTabHref } from '../tabs';

// A market's vendors are the event page's Vendors tab (#3270).
export function load({ params }) {
	redirect(308, eventTabHref(params.id, 'vendors'));
}
