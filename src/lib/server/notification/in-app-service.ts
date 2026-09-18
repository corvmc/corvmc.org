import { db } from '$lib/server/db';
import { notification } from '$lib/server/db/schema/notification';
import { eq, isNull, and, desc, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// In-app notification service
// ---------------------------------------------------------------------------
// CRUD for the notification table. Notifications are displayed in the bell
// dropdown and pushed via SSE for real-time delivery.
// ---------------------------------------------------------------------------

export interface CreateNotificationParams {
	userId: string;
	type: string;
	title: string;
	body?: string;
	href?: string;
	data?: Record<string, unknown>;
}

export async function createNotification(params: CreateNotificationParams) {
	const [row] = await db
		.insert(notification)
		.values({
			userId: params.userId,
			type: params.type,
			title: params.title,
			body: params.body ?? null,
			href: params.href ?? null,
			data: params.data ?? null
		})
		.returning();

	return row;
}

export async function getUnreadCount(userId: string): Promise<number> {
	const [result] = await db
		.select({ count: sql<number>`cast(count(*) as integer)` })
		.from(notification)
		.where(and(eq(notification.userId, userId), isNull(notification.readAt)));

	return result?.count ?? 0;
}

export async function getForUser(userId: string, opts: { limit?: number; offset?: number } = {}) {
	const limit = opts.limit ?? 20;
	const offset = opts.offset ?? 0;

	return db
		.select()
		.from(notification)
		.where(eq(notification.userId, userId))
		.orderBy(desc(notification.createdAt), desc(notification.id))
		.limit(limit)
		.offset(offset);
}

export async function markRead(notificationId: string, userId: string): Promise<void> {
	await db
		.update(notification)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notification.id, notificationId),
				eq(notification.userId, userId),
				isNull(notification.readAt)
			)
		);
}

export async function markAllRead(userId: string): Promise<void> {
	await db
		.update(notification)
		.set({ readAt: new Date() })
		.where(and(eq(notification.userId, userId), isNull(notification.readAt)));
}
