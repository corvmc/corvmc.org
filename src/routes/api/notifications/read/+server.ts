import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { markRead, markAllRead } from '#lib/server/notification/in-app-service.js';

// ---------------------------------------------------------------------------
// POST /api/notifications/read — mark notifications as read
// ---------------------------------------------------------------------------
// Body: { id: string } to mark one, or { all: true } to mark all.
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) error(401, 'Not authenticated');

	const body = (await request.json()) as { all?: boolean; id?: string };

	if (body.all === true) {
		await markAllRead(user.id);
	} else if (typeof body.id === 'string') {
		await markRead(body.id, user.id);
	} else {
		error(400, 'Provide { id } or { all: true }');
	}

	return Response.json({ ok: true });
};
