import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchArticles, resolveUserHelpRole } from '$lib/server/help/help-service';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const q = url.searchParams.get('q')?.trim();
	if (!q || q.length < 2) return json({ results: [] });

	const userRole = await resolveUserHelpRole(locals.user.id);

	const results = await searchArticles(q, userRole);
	return json({ results });
};
