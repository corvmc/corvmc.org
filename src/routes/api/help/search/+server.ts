import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchArticles, resolveHelpReader } from '$lib/server/help/help-service';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return error(401, 'Not authenticated');

	const q = url.searchParams.get('q')?.trim();
	if (!q || q.length < 2) return json({ results: [] });

	const reader = await resolveHelpReader(locals.user.id);

	const results = await searchArticles(q, reader);
	return json({ results });
};
