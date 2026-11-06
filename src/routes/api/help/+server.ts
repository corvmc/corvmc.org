import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listNonEmptyCategories,
	listArticlesByCategory,
	resolveHelpReader
} from '#lib/server/help/help-service.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const reader = await resolveHelpReader(locals.user.id);

	const categories = await listNonEmptyCategories(reader);

	const categoriesWithArticles = await Promise.all(
		categories.map(async (cat) => ({
			...cat,
			articles: await listArticlesByCategory(cat.id, reader)
		}))
	);

	return Response.json({ categories: categoriesWithArticles });
};
