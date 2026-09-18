import { db } from '$lib/server/db';
import { inboxThread, inboxMessage, inboxParticipant } from '$lib/server/db/schema/inbox';
import { and, count, desc, eq, gt, inArray, isNull, or, sql, asc } from 'drizzle-orm';
import type { PaginationInput } from '$lib/server/db/paginate';
import { paginate } from '$lib/server/db/paginate';
import { findOrCreateThread, reopenThread } from './thread-service';
import { addInboundMessage } from './message-service';

/**
 * Everything a signed-in member is allowed to do with their own conversations.
 *
 * This file is the security boundary, and it is kept small and separate on
 * purpose. Two rules hold for every query below and must keep holding:
 *
 *  1. Ownership is enforced in the WHERE clause — via a join on
 *     `inbox_participant` — never by the caller checking a returned row.
 *     Remote functions are the only guard in this app, and a guard that lives
 *     in the SQL cannot be forgotten at one call site.
 *  2. Nothing here reads `inbox_note`. Notes are staff-private. This is why
 *     these functions exist at all rather than reusing `getThread()`, which
 *     returns them.
 */

/**
 * How many conversations one member may have going at once. Not a rate limit —
 * it is what stops a runaway client (or a frustrated member) from filling the
 * staff queue with near-duplicate threads about the same thing.
 */
export const MAX_OPEN_PORTAL_THREADS = 5;

/** Statuses a member may still write into. Resolved is final by design. */
const WRITABLE_STATUSES = ['open', 'snoozed'] as const;

/** Joins the thread to the caller's participation, which is the ownership check. */
function participantOf(userId: string) {
	return and(eq(inboxParticipant.threadId, inboxThread.id), eq(inboxParticipant.userId, userId));
}

const isUnread = or(
	isNull(inboxParticipant.lastReadAt),
	gt(inboxThread.lastMessageAt, inboxParticipant.lastReadAt)
);

export interface PortalThreadSummary {
	id: string;
	subject: string | null;
	preview: string | null;
	status: (typeof inboxThread.$inferSelect)['status'];
	messageCount: number;
	lastMessageAt: Date | null;
	createdAt: Date;
	unread: boolean;
}

export async function listPortalThreads(userId: string, pagination: PaginationInput) {
	const where = and(eq(inboxThread.channel, 'portal'), eq(inboxParticipant.userId, userId));

	const dataQuery = db
		.select({
			id: inboxThread.id,
			subject: inboxThread.subject,
			preview: inboxThread.preview,
			status: inboxThread.status,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt,
			unread: sql<number>`CASE WHEN ${isUnread} THEN 1 ELSE 0 END`
		})
		.from(inboxThread)
		.innerJoin(inboxParticipant, eq(inboxParticipant.threadId, inboxThread.id))
		.where(where)
		.orderBy(desc(inboxThread.lastMessageAt))
		.$dynamic();

	const countQuery = db
		.select({ count: count() })
		.from(inboxThread)
		.innerJoin(inboxParticipant, eq(inboxParticipant.threadId, inboxThread.id))
		.where(where);

	const result = await paginate(dataQuery, countQuery, pagination);
	return {
		...result,
		rows: result.rows.map((row) => ({ ...row, unread: row.unread === 1 }))
	};
}

/**
 * One conversation, as its member is allowed to see it.
 *
 * `authorUserId` is masked to null for anyone but the caller: the timeline only
 * needs to know which bubbles are the viewer's own, so there is no reason to
 * hand out staff user ids. Notes, contact details, assignment and channel
 * metadata are all omitted — the select list here is deliberately explicit.
 */
export async function getPortalThread(threadId: string, userId: string) {
	const [thread] = await db
		.select({
			id: inboxThread.id,
			subject: inboxThread.subject,
			status: inboxThread.status,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt
		})
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(userId))
		.where(and(eq(inboxThread.id, threadId), eq(inboxThread.channel, 'portal')))
		.limit(1);

	if (!thread) return null;

	const messages = await db
		.select({
			id: inboxMessage.id,
			direction: inboxMessage.direction,
			body: inboxMessage.body,
			authorName: inboxMessage.authorName,
			authorUserId: inboxMessage.authorUserId,
			createdAt: inboxMessage.createdAt
		})
		.from(inboxMessage)
		.where(eq(inboxMessage.threadId, threadId))
		.orderBy(inboxMessage.createdAt, asc(inboxMessage.id));

	return {
		...thread,
		// Echoed back so the caller can orient the timeline without a second
		// round-trip for its own identity.
		viewerUserId: userId,
		messages: messages.map((m) => ({
			...m,
			authorUserId: m.authorUserId === userId ? userId : null
		}))
	};
}

/** Open + snoozed conversations this member already has going. */
export async function countOpenPortalThreads(userId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxThread)
		.innerJoin(inboxParticipant, eq(inboxParticipant.threadId, inboxThread.id))
		.where(
			and(
				eq(inboxThread.channel, 'portal'),
				eq(inboxParticipant.userId, userId),
				inArray(inboxThread.status, [...WRITABLE_STATUSES])
			)
		);
	return row?.count ?? 0;
}

export interface StartPortalConversationParams {
	userId: string;
	userName: string;
	userEmail: string;
	subject: string;
	body: string;
}

/**
 * Returns null when the member is already at the open-conversation cap, so the
 * caller can turn that into a field-level validation error.
 */
export async function startPortalConversation(
	params: StartPortalConversationParams
): Promise<{ threadId: string; messageId: string } | null> {
	if ((await countOpenPortalThreads(params.userId)) >= MAX_OPEN_PORTAL_THREADS) return null;

	const thread = await findOrCreateThread({
		channel: 'portal',
		contactName: params.userName,
		contactEmail: params.userEmail,
		subject: params.subject
	});

	await db
		.insert(inboxParticipant)
		.values({ threadId: thread.id, userId: params.userId, role: 'member' });

	const message = await addInboundMessage({
		threadId: thread.id,
		body: params.body,
		authorName: params.userName,
		authorUserId: params.userId
	});

	// Their own message must not come back to them as unread.
	await markPortalThreadRead(thread.id, params.userId);

	return { threadId: thread.id, messageId: message.id };
}

/**
 * Returns null unless the caller is a participant in one of their own portal
 * threads that is still writable — which covers "not yours", "not a portal
 * thread", "does not exist" and "already resolved" with one answer, because
 * the caller should not be able to tell those apart.
 */
export async function replyToPortalThread(params: {
	threadId: string;
	userId: string;
	userName: string;
	body: string;
}): Promise<{ messageId: string } | null> {
	const [thread] = await db
		.select({ id: inboxThread.id, status: inboxThread.status })
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(params.userId))
		.where(
			and(
				eq(inboxThread.id, params.threadId),
				eq(inboxThread.channel, 'portal'),
				inArray(inboxThread.status, [...WRITABLE_STATUSES])
			)
		)
		.limit(1);

	if (!thread) return null;

	// A reply to a snoozed conversation is the member asking again; put it back
	// in front of staff rather than leaving it parked.
	if (thread.status === 'snoozed') await reopenThread(thread.id);

	const message = await addInboundMessage({
		threadId: thread.id,
		body: params.body,
		authorName: params.userName,
		authorUserId: params.userId
	});

	await markPortalThreadRead(thread.id, params.userId);

	return { messageId: message.id };
}

export async function markPortalThreadRead(threadId: string, userId: string): Promise<void> {
	await db
		.update(inboxParticipant)
		.set({ lastReadAt: new Date() })
		.where(and(eq(inboxParticipant.threadId, threadId), eq(inboxParticipant.userId, userId)));
}

/** Drives the "Messages" badge in the member nav. */
export async function countPortalUnread(userId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxParticipant)
		.innerJoin(inboxThread, eq(inboxThread.id, inboxParticipant.threadId))
		.where(and(eq(inboxParticipant.userId, userId), eq(inboxThread.channel, 'portal'), isUnread));
	return row?.count ?? 0;
}

/** The signed-in people on a thread, for notification fan-out. */
export async function listThreadParticipants(threadId: string) {
	return db
		.select({ userId: inboxParticipant.userId, role: inboxParticipant.role })
		.from(inboxParticipant)
		.where(eq(inboxParticipant.threadId, threadId));
}
