import { redirect } from '@sveltejs/kit';

// Chat moved into the band's inbox beside its enquiries. The nav row is gone,
// but the topbar's messages icon and any bookmark still point here.
export function load({ params }) {
	redirect(308, `/band/${params.slug}/messages/chat`);
}
