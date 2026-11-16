import type { RequestHandler } from './$types';
import { requireCapability } from '#lib/server/authorization.js';
import { searchMembers } from '#lib/server/band/band-service.js';

export const GET: RequestHandler = async ({ params, url }) => {
	await requireCapability('band.manageMembers');
	const q = url.searchParams.get('q') ?? '';
	if (q.length < 2) return Response.json([]);
	const results = await searchMembers(q, params.id);
	return Response.json(results);
};
