import { redirect } from '@sveltejs/kit';

// Chat moved into the band's inbox beside its enquiries, and became several
// topics rather than one room — so there is no single thread to land on. The
// inbox lists them.
export function load({ params }) {
	redirect(308, `/band/${params.slug}/messages`);
}
