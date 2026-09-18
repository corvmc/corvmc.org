import type { AnyColumn } from 'drizzle-orm';
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, count, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '$lib/server/db';
import { inboxThread, inboxParticipant, inboxGroupRead } from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
import { paginate } from '$lib/server/db/paginate';
import type { PaginationInput } from '$lib/server/db/paginate';
import { messagingDisabledFor } from './direct-service';
import type { UnifiedConversation } from '$lib/types/conversation';

/**
 * Every thread one member can read, whichever inbox it is in (#1250).
 *
 * `groupId` already models the inbox; this adds the *union*, because the two
 * halves establish readership differently — own by an `inbox_participant`
 * row, group by the roster resolved live. One query, not two merged: the list
 * pages by activity across every inbox, which two pagers cannot interleave.
 */

export type InboxScope =
	| 'all'
	| 'own'
	/**
	 * One group's inbox. `channel` narrows it further to one of its two thread
	 * kinds — the band panel's Messages row is enquiries only, because its
	 * sibling Chat row is the other half and showing both would double them.
	 */
	| { groupId: string; channel?: 'band' | 'group' };

/**
 * Which groups this viewer may read, split by what they may read *of* them.
 *
 * A group has two thread kinds under one `groupId` and they do not share a
 * gate: its chat is every active member's, its enquiries are the owners' and
 * admins'. A plain bandmate sees the room and not the bookings.
 */
export interface GroupAccess {
	/** Active membership — the chat. */
	memberOf: string[];
	/** Owner or admin — the enquiries. A subset of `memberOf`. */
	adminOf: string[];
}

/** The viewer's cursor on their own thread. */
const ownUnread = or(
	isNull(inboxParticipant.lastReadAt),
	gt(inboxThread.lastMessageAt, inboxParticipant.lastReadAt)
);

/** The viewer's cursor on any group thread — chat or enquiry, same table. */
const groupUnread = or(
	isNull(inboxGroupRead.lastReadAt),
	gt(inboxThread.lastMessageAt, inboxGroupRead.lastReadAt)
);

/**
 * The where clause. Access is resolved by the caller from the roster rather
 * than here, so this file never asks who anybody is.
 */
function readableBy(access: GroupAccess, otherUserId: AnyColumn) {
	const clauses = [
		and(
			inArray(inboxThread.channel, ['portal', 'direct'] as const),
			isNotNull(inboxParticipant.id),
			// A member who switched messaging off drops out of the other person's
			// list. Portal threads have no `other`, so this is vacuously true.
			sql`NOT ${messagingDisabledFor(otherUserId)}`
		)
	];

	if (access.memberOf.length > 0) {
		clauses.push(
			and(eq(inboxThread.channel, 'group'), inArray(inboxThread.groupId, access.memberOf))
		);
	}
	if (access.adminOf.length > 0) {
		clauses.push(
			and(eq(inboxThread.channel, 'band'), inArray(inboxThread.groupId, access.adminOf))
		);
	}

	return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export async function listUnifiedConversations(
	userId: string,
	access: GroupAccess,
	scope: InboxScope,
	pagination: PaginationInput
) {
	const other = alias(inboxParticipant, 'other_participant');
	const otherUser = alias(user, 'other_user');

	const readable = readableBy(access, other.userId);
	const scoped =
		scope === 'all'
			? readable
			: scope === 'own'
				? and(readable, isNull(inboxThread.groupId))
				: and(
						readable,
						eq(inboxThread.groupId, scope.groupId),
						// One of the group's two thread kinds, when the caller wants just
						// one — the band panel's Messages row is enquiries only.
						scope.channel ? eq(inboxThread.channel, scope.channel) : undefined
					);

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
		                         THEN (CASE WHEN ${groupUnread} THEN 1 ELSE 0 END)
		                         ELSE (CASE WHEN ${ownUnread} THEN 1 ELSE 0 END) END`,
		pending: sql<number>`CASE WHEN ${inboxThread.channel} = 'direct'
		                           AND ${inboxParticipant.acceptedAt} IS NULL
		                          THEN 1 ELSE 0 END`,
		counterpartName: sql<string | null>`COALESCE(${otherUser.name}, ${inboxThread.contactName})`,
		groupName: group.name
	};

	const dataQuery = db
		.select(select)
		.from(inboxThread)
		.leftJoin(inboxParticipant, mine)
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.leftJoin(otherUser, eq(otherUser.id, other.userId))
		.leftJoin(group, eq(group.id, inboxThread.groupId))
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

/**
 * Which group a thread belongs to, and on which channel, for a guard that
 * starts from the thread id. Null for the viewer's own threads.
 */
export async function groupOfThread(
	threadId: string
): Promise<{ id: string; slug: string; name: string; channel: 'band' | 'group' } | null> {
	const [row] = await db
		.select({ id: group.id, slug: group.slug, name: group.name, channel: inboxThread.channel })
		.from(inboxThread)
		.innerJoin(group, eq(group.id, inboxThread.groupId))
		.where(eq(inboxThread.id, threadId))
		.limit(1);
	if (!row) return null;
	if (row.channel !== 'band' && row.channel !== 'group') return null;
	return { id: row.id, slug: row.slug, name: row.name, channel: row.channel };
}

/** Unread across every inbox the viewer can read — the topbar's one number. */
export async function countUnifiedUnread(userId: string, access: GroupAccess): Promise<number> {
	const other = alias(inboxParticipant, 'other_participant');
	const readable = readableBy(access, other.userId);

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
				sql`CASE WHEN ${inboxThread.groupId} IS NOT NULL THEN ${groupUnread} ELSE ${ownUnread} END`
			)
		);

	return row?.count ?? 0;
}
