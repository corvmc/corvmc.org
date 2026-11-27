import { redirect } from '@sveltejs/kit';

// Announcements became a thread in the band's Messages, beside General
// (#3229). Links in announcement emails sent before then still land here.
export function load({ params }) {
	redirect(308, `/band/${params.slug}/messages`);
}
