import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getArticleBySlug, resolveUserHelpRole } from '$lib/server/help/help-service';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const userRole = await resolveUserHelpRole(locals.user.id);

	const article = await getArticleBySlug(params.slug, userRole);
	if (!article) return error(404, 'Article not found');

	return json({ article });
};
