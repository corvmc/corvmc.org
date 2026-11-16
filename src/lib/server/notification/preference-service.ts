import { db } from '#lib/server/db/index.js';
import { notificationPreference } from '#lib/server/db/schema/notification.js';
import { eq, and } from 'drizzle-orm';
import { getNotificationType } from '#lib/server/db/schema/notification.js';

// ---------------------------------------------------------------------------
// Notification preference service
// ---------------------------------------------------------------------------
// Reads/writes per-user, per-type channel preferences. If no row exists
// for a (user, type) pair, the type's defaults are used.
// ---------------------------------------------------------------------------

export interface ChannelPreference {
	email: boolean;
	inApp: boolean;
	sms: boolean;
}

/**
 * Get the effective channel preference for a user + notification type.
 * Falls back to the type's defaults if no preference row exists.
 */
export async function getPreference(
	userId: string,
	notificationType: string
): Promise<ChannelPreference> {
	const typeDef = getNotificationType(notificationType);

	// Mandatory notifications always send on their default channels
	if (typeDef?.mandatory) {
		return typeDef.defaults;
	}

	const [row] = await db
		.select({
			emailEnabled: notificationPreference.emailEnabled,
			inAppEnabled: notificationPreference.inAppEnabled,
			smsEnabled: notificationPreference.smsEnabled
		})
		.from(notificationPreference)
		.where(
			and(
				eq(notificationPreference.userId, userId),
				eq(notificationPreference.notificationType, notificationType)
			)
		)
		.limit(1);

	if (row) {
		return { email: row.emailEnabled, inApp: row.inAppEnabled, sms: row.smsEnabled };
	}

	return typeDef?.defaults ?? { email: true, inApp: true, sms: false };
}

/**
 * Get all preferences for a user, keyed by notification type.
 */
export async function getAllPreferences(
	userId: string
): Promise<Record<string, ChannelPreference>> {
	const rows = await db
		.select()
		.from(notificationPreference)
		.where(eq(notificationPreference.userId, userId));

	const prefs: Record<string, ChannelPreference> = {};
	for (const row of rows) {
		prefs[row.notificationType] = {
			email: row.emailEnabled,
			inApp: row.inAppEnabled,
			sms: row.smsEnabled
		};
	}
	return prefs;
}

/**
 * Upsert a user's preference for a notification type.
 */
export async function setPreference(
	userId: string,
	notificationType: string,
	channels: ChannelPreference
): Promise<void> {
	await db
		.insert(notificationPreference)
		.values({
			userId,
			notificationType,
			emailEnabled: channels.email,
			inAppEnabled: channels.inApp,
			smsEnabled: channels.sms
		})
		.onConflictDoUpdate({
			target: [notificationPreference.userId, notificationPreference.notificationType],
			set: {
				emailEnabled: channels.email,
				inAppEnabled: channels.inApp,
				smsEnabled: channels.sms,
				updatedAt: new Date()
			}
		});
}
