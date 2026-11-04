import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getForUser, getUnreadCount } from '#lib/server/notification/in-app-service.js';

// ---------------------------------------------------------------------------
// GET /api/notifications — list notifications for the current user
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) error(401, 'Not authenticated');

	const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);

	const [notifications, unreadCount] = await Promise.all([
		getForUser(user.id, { limit, offset }),
		getUnreadCount(user.id)
	]);

	return json({ notifications, unreadCount });
};
