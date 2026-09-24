import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireCapability } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { or } from 'drizzle-orm';
import { containsLiteral } from '$lib/server/db/like';
import { SEARCH_LIMIT } from '$lib/config';

export const GET: RequestHandler = async ({ url }) => {
	await requireCapability('user.list');
	const q = url.searchParams.get('q') ?? '';
	if (q.length < 2) return json([]);
	const results = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(or(containsLiteral(user.name, q), containsLiteral(user.email, q)))
		.limit(SEARCH_LIMIT);
	return json(results);
};
