import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, command, getRequestEvent } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import {
	getForUser,
	getUnreadCount,
	markRead,
	markAllRead
} from '$lib/server/notification/in-app-service';
import { getAllPreferences, setPreference } from '$lib/server/notification/preference-service';
import { getMemberAccount } from './account.remote';
import { NOTIFICATION_TYPES, getNotificationType } from '$lib/server/db/schema/notification';

function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');
	return locals.user;
}

export const getNotifications = query(async () => {
	const user = requireUser();
	const [notifications, unreadCount] = await Promise.all([
		getForUser(user.id, { limit: 10 }),
		getUnreadCount(user.id)
	]);
	return { notifications, unreadCount };
});

export const markNotificationRead = command(z.object({ id: z.string().min(1) }), async ({ id }) => {
	const user = requireUser();
	await markRead(id, user.id);
});

export const markAllNotificationsRead = command(async () => {
	const user = requireUser();
	await markAllRead(user.id);
});

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export const getNotificationPreferences = query(async () => {
	const user = requireUser();
	const prefs = await getAllPreferences(user.id);
	return NOTIFICATION_TYPES.filter((t) => !t.mandatory).map((t) => ({
		key: t.key,
		label: t.label,
		description: t.description,
		email: prefs[t.key]?.email ?? t.defaults.email,
		inApp: prefs[t.key]?.inApp ?? t.defaults.inApp,
		sms: prefs[t.key]?.sms ?? t.defaults.sms
	}));
});

export const setNotificationPreference = command(
	z.object({
		notificationType: z.string().min(1),
		email: z.boolean(),
		inApp: z.boolean(),
		sms: z.boolean().optional().default(false)
	}),
	async ({ notificationType, email, inApp, sms }) => {
		const user = requireUser();
		const typeDef = getNotificationType(notificationType);
		if (!typeDef) throw error(400, 'Unknown notification type');
		if (typeDef.mandatory)
			throw error(400, 'Cannot change preferences for mandatory notifications');

		await setPreference(user.id, notificationType, { email, inApp, sms });
		void getMemberAccountPage().refresh();
	}
);

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserNotifications = query(z.string(), async (userId) => {
	await requireCapability('user.read');
	const [items, unread, preferences] = await Promise.all([
		getForUser(userId, { limit: 10 }),
		getUnreadCount(userId),
		getAllPreferences(userId)
	]);
	return { items, unread, preferences };
});

/**
 * The account page's one load-bearing query.
 *
 * Here rather than in `account.remote.ts` so that file does not have to import this one — the
 * notification preferences are refreshed from this file, and keeping the wrapper beside that
 * mutation lets `custom/refresh-the-composed-query` check the two against each other.
 */
export const getMemberAccountPage = query(z.void(), async () => {
	const [account, notificationPreferences] = await Promise.all([
		getMemberAccount(),
		getNotificationPreferences()
	]);
	return { account, notificationPreferences };
});
