import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getArticleBySlug, resolveHelpReader } from '$lib/server/help/help-service';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const reader = await resolveHelpReader(locals.user.id);

	const article = await getArticleBySlug(params.slug, reader);
	if (!article) return error(404, 'Article not found');

	return json({ article });
};
