import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getAllPreferences, setPreference } from '#lib/server/notification/preference-service.js';
import { NOTIFICATION_TYPES } from '#lib/server/db/schema/notification.js';

// ---------------------------------------------------------------------------
// GET /api/notifications/preferences — list all preferences for current user
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Not authenticated');

	const prefs = await getAllPreferences(user.id);

	const result = NOTIFICATION_TYPES.filter((t) => !t.mandatory).map((t) => ({
		key: t.key,
		label: t.label,
		description: t.description,
		email: prefs[t.key]?.email ?? t.defaults.email,
		inApp: prefs[t.key]?.inApp ?? t.defaults.inApp,
		sms: prefs[t.key]?.sms ?? t.defaults.sms
	}));

	return Response.json(result);
};

// ---------------------------------------------------------------------------
// POST /api/notifications/preferences — update a single preference
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) error(401, 'Not authenticated');

	const body = (await request.json()) as {
		notificationType: unknown;
		email: unknown;
		inApp: unknown;
		sms: unknown;
	};
	const { notificationType, email, inApp, sms } = body;

	if (typeof notificationType !== 'string') {
		error(400, 'notificationType is required');
	}

	const validType = NOTIFICATION_TYPES.find((t) => t.key === notificationType);
	if (!validType) {
		error(400, 'Unknown notification type');
	}
	if (validType.mandatory) {
		error(400, 'Cannot change preferences for mandatory notifications');
	}

	await setPreference(user.id, notificationType, {
		email: Boolean(email),
		inApp: Boolean(inApp),
		sms: Boolean(sms)
	});

	return Response.json({ ok: true });
};
