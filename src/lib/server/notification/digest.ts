import { and, desc, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { DIGEST_TYPE, HELD_FOR_DIGEST, notification } from '#lib/server/db/schema/notification.js';
import { dayStamp, digestWindow } from '#lib/server/reminders/daily-latch.js';
import { chunkInsert } from '#lib/server/utils/chunk.js';
import type { DigestData, DigestItem } from '#lib/utils/notification-digest.js';

/**
 * The daily in-app digest (#3409): one `notification_digest` row per member
 * who has notices held since the last pass, from 9am club time. Held rows are
 * ordinary `notification` rows flagged in `data` by the dispatcher; they stay
 * out of the bell and the unread count, and this row is where they surface.
 *
 * In-app only: email is unchanged for every type. Not a reminder-registry entry,
 * for the reason open shifts are not: the registry dispatches once per member,
 * and these rows are written directly.
 */

/** The latch key, in `reminder_sent`. */
export const IN_APP_DIGEST_KEY = 'notification_digest';

/** Notices named in the summary; the rest are a count. */
const ITEM_LIMIT = 8;

export interface InAppDigestResult {
	due: boolean;
	members: number;
	held: number;
}

function summary(items: DigestItem[], ids: string[]): DigestData {
	return { ids, items: items.slice(0, ITEM_LIMIT), count: ids.length };
}

/**
 * Write today's digest if it is owed. The day is stamped even when nothing is
 * held, so a notice held after 9am waits for tomorrow's.
 *
 * `now` is cut to whole seconds, which is what `created_at` stores, so
 * `[since, until)` partitions the held rows: the stamp records `until` and the
 * next pass starts from it.
 *
 * Throws on a failed write, leaving the day and the held rows for the next pass.
 */
export async function sendInAppDigest(now: Date = new Date()): Promise<InAppDigestResult> {
	const window = await digestWindow(IN_APP_DIGEST_KEY, now);
	if (!window) return { due: false, members: 0, held: 0 };
	const until = new Date(Math.floor(now.getTime() / 1000) * 1000);
	const stamp = dayStamp(IN_APP_DIGEST_KEY, window, until);

	const held = await db
		.select({
			id: notification.id,
			userId: notification.userId,
			title: notification.title,
			href: notification.href
		})
		.from(notification)
		.where(
			and(
				isNull(notification.readAt),
				ne(notification.type, DIGEST_TYPE),
				gte(notification.createdAt, window.since),
				lt(notification.createdAt, until),
				sql`json_extract(${notification.data}, ${'$.' + HELD_FOR_DIGEST}) is not null`
			)
		)
		.orderBy(desc(notification.createdAt), desc(notification.id));

	const byMember = new Map<string, typeof held>();
	for (const row of held) byMember.set(row.userId, [...(byMember.get(row.userId) ?? []), row]);

	const rows = [...byMember].map(([userId, mine]) => ({
		userId,
		type: DIGEST_TYPE,
		title: 'Daily summary',
		body: mine.length === 1 ? '1 notice' : `${mine.length} notices`,
		data: summary(
			mine.map((r) => ({ title: r.title, href: r.href })),
			mine.map((r) => r.id)
		)
	}));

	await db.batch([
		stamp,
		...chunkInsert(rows, (group) => db.insert(notification).values(group))
	] as unknown as Parameters<typeof db.batch>[0]);

	return { due: true, members: rows.length, held: held.length };
}
