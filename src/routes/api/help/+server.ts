import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listCategories,
	listArticlesByCategory,
	resolveUserHelpRole
} from '$lib/server/help/help-service';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const userRole = await resolveUserHelpRole(locals.user.id);

	const categories = await listCategories(userRole);

	const categoriesWithArticles = await Promise.all(
		categories.map(async (cat) => ({
			...cat,
			articles: await listArticlesByCategory(cat.id, userRole)
		}))
	);

	return json({ categories: categoriesWithArticles });
};
