import type { RequestHandler } from './$types';
import { requireCapability } from '#lib/server/authorization.js';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { or } from 'drizzle-orm';
import { containsLiteral } from '#lib/server/db/like.js';
import { SEARCH_LIMIT } from '#lib/config.js';

export const GET: RequestHandler = async ({ url }) => {
	await requireCapability('user.list');
	const q = url.searchParams.get('q') ?? '';
	if (q.length < 2) return Response.json([]);
	const results = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(or(containsLiteral(user.name, q), containsLiteral(user.email, q)))
		.limit(SEARCH_LIMIT);
	return Response.json(results);
};
