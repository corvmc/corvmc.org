import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireCapability } from '$lib/server/authorization';
import { searchMembers } from '$lib/server/band/band-service';

export const GET: RequestHandler = async ({ params, url }) => {
	await requireCapability('band.manageMembers');
	const q = url.searchParams.get('q') ?? '';
	if (q.length < 2) return json([]);
	const results = await searchMembers(q, params.id);
	return json(results);
};
