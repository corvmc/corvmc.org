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

/** Seven bound columns a row: 12 rows is 84 parameters, under D1's 100. */
const INSERT_CHUNK = 12;

/** Many rows in as few statements as D1 allows, in one batch. No ids come back. */
export async function createNotifications(rows: CreateNotificationParams[]): Promise<void> {
	if (rows.length === 0) return;
	const statements = [];
	for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
		statements.push(
			db.insert(notification).values(
				rows.slice(i, i + INSERT_CHUNK).map((p) => ({
					userId: p.userId,
					type: p.type,
					title: p.title,
					body: p.body ?? null,
					href: p.href ?? null,
					data: p.data ?? null
				}))
			)
		);
	}
	await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
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
