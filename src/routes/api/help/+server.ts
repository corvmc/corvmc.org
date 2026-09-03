import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listCategories,
	listArticlesByCategory,
	resolveHelpAudience
} from '$lib/server/help/help-service';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const audience = await resolveHelpAudience(locals.user.id);

	const categories = await listCategories(audience);

	const categoriesWithArticles = await Promise.all(
		categories.map(async (cat) => ({
			...cat,
			articles: await listArticlesByCategory(cat.id, audience)
		}))
	);

	return json({ categories: categoriesWithArticles });
};
