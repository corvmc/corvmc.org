import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/**
 * The press kit stopped being a premium feature, so it stopped living under the
 * premium page editor. 308 rather than 302 — the move is permanent, and this
 * path is in the help articles and in the browser history of every band that
 * ever opened it.
 */
export const load: PageLoad = ({ params }) => {
	redirect(308, resolve('/band/[slug]/press-kit', { slug: params.slug }));
};
