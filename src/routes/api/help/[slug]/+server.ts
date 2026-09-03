import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getArticleBySlug, resolveHelpAudience } from '$lib/server/help/help-service';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const audience = await resolveHelpAudience(locals.user.id);

	const article = await getArticleBySlug(params.slug, audience);
	if (!article) return error(404, 'Article not found');

	return json({ article });
};
