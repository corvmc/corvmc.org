import type { AnyColumn } from 'drizzle-orm';
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, count, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '$lib/server/db';
import { inboxThread, inboxParticipant, inboxGroupRead } from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { paginate } from '$lib/server/db/paginate';
import type { PaginationInput } from '$lib/server/db/paginate';
import { messagingDisabledFor } from './direct-service';

/**
 * Every thread one member can read, whichever inbox it is in.
 *
 * `inbox_thread.groupId` already models the inbox — null is the member's own
 * correspondence with CorvMC or another member, a group id is that band's
 * booking enquiries. What this adds is the *union*, because the two halves
 * establish readership differently and deliberately so (#1250):
 *
 *   own   — an `inbox_participant` row naming the viewer
 *   band  — no participant row at all; the roster decides, live, so a new
 *           admin inherits the back catalogue and a departing one loses it
 *
 * One query rather than two merged in memory: the list is paginated by last
 * activity across every inbox, and two independently-paged readers cannot be
 * interleaved correctly.
 */

export type InboxScope = 'all' | 'own' | { groupId: string };

export interface UnifiedConversation {
	id: string;
	channel: (typeof inboxThread.$inferSelect)['channel'];
	subject: string | null;
	preview: string | null;
	status: (typeof inboxThread.$inferSelect)['status'];
	lastMessageAt: Date | null;
	unread: boolean;
	/** A direct request the viewer has not accepted. Never true for a band thread. */
	pending: boolean;
	/** Null for the viewer's own threads; the band's id for an enquiry. */
	groupId: string | null;
	/** Who the thread is with — the other member, or the booker who wrote in. */
	counterpartName: string | null;
}

/** The viewer's cursor on their own thread. */
const ownUnread = or(
	isNull(inboxParticipant.lastReadAt),
	gt(inboxThread.lastMessageAt, inboxParticipant.lastReadAt)
);

/** The viewer's cursor on a band thread, which lives in its own table. */
const bandUnread = or(
	isNull(inboxGroupRead.lastReadAt),
	gt(inboxThread.lastMessageAt, inboxGroupRead.lastReadAt)
);

/**
 * The where clause, given the band ids the viewer administers.
 *
 * `adminGroupIds` is resolved by the caller from the roster rather than here:
 * a band appears in somebody's Messages only where they are owner or admin,
 * and that is the same gate the band panel's own route applies.
 */
function readableBy(adminGroupIds: string[], otherUserId: AnyColumn) {
	const own = and(
		inArray(inboxThread.channel, ['portal', 'direct'] as const),
		isNotNull(inboxParticipant.id),
		// A member who switched messaging off drops out of the other person's
		// list. Portal threads have no `other`, so this is vacuously true.
		sql`NOT ${messagingDisabledFor(otherUserId)}`
	);

	if (adminGroupIds.length === 0) return own;

	return or(own, and(eq(inboxThread.channel, 'band'), inArray(inboxThread.groupId, adminGroupIds)));
}

export async function listUnifiedConversations(
	userId: string,
	adminGroupIds: string[],
	scope: InboxScope,
	pagination: PaginationInput
) {
	const other = alias(inboxParticipant, 'other_participant');
	const otherUser = alias(user, 'other_user');

	const readable = readableBy(adminGroupIds, other.userId);
	const scoped =
		scope === 'all'
			? readable
			: scope === 'own'
				? and(readable, isNull(inboxThread.groupId))
				: and(readable, eq(inboxThread.groupId, scope.groupId));

	const mine = and(
		eq(inboxParticipant.threadId, inboxThread.id),
		eq(inboxParticipant.userId, userId)
	);

	const select = {
		id: inboxThread.id,
		channel: inboxThread.channel,
		subject: inboxThread.subject,
		preview: inboxThread.preview,
		status: inboxThread.status,
		lastMessageAt: inboxThread.lastMessageAt,
		groupId: inboxThread.groupId,
		// Which cursor answers depends on which inbox the row is in — the whole
		// reason this is a union rather than one join.
		unread: sql<number>`CASE WHEN ${inboxThread.groupId} IS NOT NULL
		                         THEN (CASE WHEN ${bandUnread} THEN 1 ELSE 0 END)
		                         ELSE (CASE WHEN ${ownUnread} THEN 1 ELSE 0 END) END`,
		pending: sql<number>`CASE WHEN ${inboxThread.channel} = 'direct'
		                           AND ${inboxParticipant.acceptedAt} IS NULL
		                          THEN 1 ELSE 0 END`,
		counterpartName: sql<string | null>`COALESCE(${otherUser.name}, ${inboxThread.contactName})`
	};

	const dataQuery = db
		.select(select)
		.from(inboxThread)
		.leftJoin(inboxParticipant, mine)
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.leftJoin(otherUser, eq(otherUser.id, other.userId))
		.leftJoin(
			inboxGroupRead,
			and(eq(inboxGroupRead.threadId, inboxThread.id), eq(inboxGroupRead.userId, userId))
		)
		.where(scoped)
		.orderBy(desc(inboxThread.lastMessageAt))
		.$dynamic();

	const countQuery = db
		.select({ count: count() })
		.from(inboxThread)
		.leftJoin(inboxParticipant, mine)
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.leftJoin(
			inboxGroupRead,
			and(eq(inboxGroupRead.threadId, inboxThread.id), eq(inboxGroupRead.userId, userId))
		)
		.where(scoped);

	const result = await paginate(dataQuery, countQuery, pagination);
	return {
		...result,
		rows: result.rows.map((row): UnifiedConversation => ({
			...row,
			unread: row.unread === 1,
			pending: row.pending === 1
		}))
	};
}

/** Unread across every inbox the viewer can read — the topbar's one number. */
export async function countUnifiedUnread(userId: string, adminGroupIds: string[]): Promise<number> {
	const other = alias(inboxParticipant, 'other_participant');
	const readable = readableBy(adminGroupIds, other.userId);

	const [row] = await db
		.select({ count: count() })
		.from(inboxThread)
		.leftJoin(
			inboxParticipant,
			and(eq(inboxParticipant.threadId, inboxThread.id), eq(inboxParticipant.userId, userId))
		)
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.leftJoin(
			inboxGroupRead,
			and(eq(inboxGroupRead.threadId, inboxThread.id), eq(inboxGroupRead.userId, userId))
		)
		.where(
			and(
				readable,
				eq(inboxThread.status, 'open'),
				sql`CASE WHEN ${inboxThread.groupId} IS NOT NULL THEN ${bandUnread} ELSE ${ownUnread} END`
			)
		);

	return row?.count ?? 0;
}
