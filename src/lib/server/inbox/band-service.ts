import { db } from '$lib/server/db';
import { inboxThread, inboxMessage, inboxGroupRead } from '$lib/server/db/schema/inbox';
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PaginationInput } from '$lib/server/db/paginate';
import { paginate } from '$lib/server/db/paginate';
import { BAND_ENQUIRY_SUBJECT } from '$lib/config';
import { findOrCreateThread, reopenThread } from './thread-service';
import { addInboundMessage, addOutboundMessage } from './message-service';

/**
 * Everything a band is allowed to do with the enquiries its booking form
 * collects.
 *
 * This file is the security boundary, and it is kept small and separate for the
 * same reasons `portal-service.ts` is. Three rules hold for every query below:
 *
 *  1. **Ownership is enforced in the WHERE clause**, as `inbox_thread.group_id =
 *     <the resolved band>`, never by the caller checking a returned row. The
 *     band id comes from `requireGroupRole` in the remote function, which
 *     resolves it from a slug and then checks the caller's role on the resolved
 *     group — so what reaches here is already an authorisation, not a lookup key
 *     the client chose.
 *  2. **Nothing here reads `inbox_note`.** Notes are staff-private, and a band
 *     thread should never acquire one — but the isolation is structural rather
 *     than a promise about what staff will do, exactly as it is for the portal.
 *  3. **Nothing here writes `inbox_participant`.** Who may read a band thread is
 *     the roster, resolved live, so there is no participant row to write. There
 *     is also a concrete cost to writing one: every member-side query in
 *     `direct-service.ts` and `portal-service.ts` finds its threads by joining
 *     that table, so a band thread with participant rows would appear in
 *     `/member/messages`. Read cursors go in `inbox_group_read` instead.
 */

/**
 * Statuses a band may still write into. Resolved is not one of them — but unlike
 * the portal it is not a dead end either: `setBandThreadStatus` reopens, and so
 * does the booker writing back. See that function.
 */
const WRITABLE_STATUSES = ['open', 'snoozed'] as const;

/** Statuses a band may move a thread between. Snooze and assignment are staff-queue tools. */
export const BAND_THREAD_STATUSES = ['open', 'resolved'] as const;
export type BandThreadStatus = (typeof BAND_THREAD_STATUSES)[number];

/**
 * Unread for this reader: never opened, or opened before the last message
 * arrived. Written against a LEFT JOIN, so "no row at all" is the null case and
 * an enquiry nobody has looked at is unread for the whole band.
 */
const isUnread = or(
	isNull(inboxGroupRead.lastReadAt),
	gt(inboxThread.lastMessageAt, inboxGroupRead.lastReadAt)
);

/** Joins a thread to one reader's cursor. */
function readCursorOf(userId: string) {
	return and(eq(inboxGroupRead.threadId, inboxThread.id), eq(inboxGroupRead.userId, userId));
}

/** The band's own threads, and only those. */
function ownedBy(groupId: string) {
	return and(eq(inboxThread.channel, 'band'), eq(inboxThread.groupId, groupId));
}

export interface BandThreadSummary {
	id: string;
	subject: string | null;
	preview: string | null;
	status: (typeof inboxThread.$inferSelect)['status'];
	contactName: string | null;
	messageCount: number;
	lastMessageAt: Date | null;
	createdAt: Date;
	unread: boolean;
	/** True once the band has answered and the booker has not written back. */
	awaitingReply: boolean;
}

export async function listBandThreads(
	groupId: string,
	viewerUserId: string,
	pagination: PaginationInput
) {
	const where = ownedBy(groupId);

	const dataQuery = db
		.select({
			id: inboxThread.id,
			subject: inboxThread.subject,
			preview: inboxThread.preview,
			status: inboxThread.status,
			contactName: inboxThread.contactName,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt,
			unread: sql<number>`CASE WHEN ${isUnread} THEN 1 ELSE 0 END`,
			awaitingReply: sql<number>`CASE WHEN ${inboxThread.awaitingReplySince} IS NOT NULL THEN 1 ELSE 0 END`
		})
		.from(inboxThread)
		.leftJoin(inboxGroupRead, readCursorOf(viewerUserId))
		.where(where)
		.orderBy(desc(inboxThread.lastMessageAt))
		.$dynamic();

	const countQuery = db.select({ count: count() }).from(inboxThread).where(where);

	const result = await paginate(dataQuery, countQuery, pagination);
	return {
		...result,
		rows: result.rows.map((row) => ({
			...row,
			unread: row.unread === 1,
			awaitingReply: row.awaitingReply === 1
		}))
	};
}

/**
 * One enquiry, as the band is allowed to see it.
 *
 * `authorUserId` never leaves this function. The timeline orients on
 * `direction` — the band is an organisation here, the same way staff are in
 * `/staff/inbox`, so a colleague's reply has to read as the band's rather than
 * as somebody else's. `authorName` is what says which bandmate wrote it, and it
 * is already on the row.
 */
export async function getBandThread(threadId: string, groupId: string) {
	const [thread] = await db
		.select({
			id: inboxThread.id,
			subject: inboxThread.subject,
			status: inboxThread.status,
			contactName: inboxThread.contactName,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt
		})
		.from(inboxThread)
		.where(and(eq(inboxThread.id, threadId), ownedBy(groupId)))
		.limit(1);

	if (!thread) return null;

	const messages = await db
		.select({
			id: inboxMessage.id,
			direction: inboxMessage.direction,
			body: inboxMessage.body,
			authorName: inboxMessage.authorName,
			createdAt: inboxMessage.createdAt
		})
		.from(inboxMessage)
		.where(eq(inboxMessage.threadId, threadId))
		.orderBy(inboxMessage.createdAt);

	return { ...thread, messages };
}

export interface BandEnquiryParams {
	groupId: string;
	name: string;
	email: string;
	message: string;
}

/**
 * A stranger writing to an act through its public booking form.
 *
 * Always a new thread, never folded into an open one. The form is one-shot and
 * carries no thread id, so the only thing it could be folded on is the sender's
 * address — which would let someone append to a negotiation the band had
 * already resolved, and would merge two unrelated enquiries from the same
 * booking agent.
 */
export async function handleBandEnquiry(
	params: BandEnquiryParams
): Promise<{ threadId: string; messageId: string }> {
	const thread = await findOrCreateThread({
		channel: 'band',
		groupId: params.groupId,
		contactName: params.name,
		contactEmail: params.email,
		subject: BAND_ENQUIRY_SUBJECT
	});

	const message = await addInboundMessage({
		threadId: thread.id,
		body: params.message,
		authorName: params.name
	});

	return { threadId: thread.id, messageId: message.id };
}

/**
 * Returns null unless the thread is this band's and still writable — which
 * covers "another band's", "not a band thread", "does not exist" and "already
 * resolved" with one answer.
 */
export async function replyToBandThread(params: {
	threadId: string;
	groupId: string;
	userId: string;
	userName: string;
	body: string;
}): Promise<{ messageId: string } | null> {
	const [thread] = await db
		.select({ id: inboxThread.id, status: inboxThread.status })
		.from(inboxThread)
		.where(
			and(
				eq(inboxThread.id, params.threadId),
				ownedBy(params.groupId),
				inArray(inboxThread.status, [...WRITABLE_STATUSES])
			)
		)
		.limit(1);

	if (!thread) return null;

	if (thread.status === 'snoozed') await reopenThread(thread.id);

	// Sends the email as a side effect and throws if it cannot, so a reply the
	// booker never received is never recorded as one the band sent.
	const message = await addOutboundMessage({
		threadId: thread.id,
		body: params.body,
		authorName: params.userName,
		authorUserId: params.userId
	});

	await markBandThreadRead(thread.id, params.groupId, params.userId);

	return { messageId: message.id };
}

/**
 * Open ⇄ resolved, and nothing else.
 *
 * Unlike the portal, resolving is **not** final here: the band closes an enquiry
 * it has finished with, and a booker who writes back reopens it through
 * `addInboundMessage`. A four-person act is not a work queue, and an
 * irreversible archive would only teach them not to use the button.
 */
export async function setBandThreadStatus(
	threadId: string,
	groupId: string,
	status: BandThreadStatus
): Promise<boolean> {
	const result = await db
		.update(inboxThread)
		.set({
			status,
			// The queue's markers mean nothing on a thread the band has closed, and
			// leaving one behind would show a resolved enquiry as still waiting.
			...(status === 'resolved' ? { awaitingReplySince: null } : {}),
			snoozedUntil: null,
			updatedAt: new Date()
		})
		.where(and(eq(inboxThread.id, threadId), ownedBy(groupId)))
		.returning({ id: inboxThread.id });

	return result.length > 0;
}

/**
 * Stamp this reader's cursor, creating it on first open.
 *
 * Guarded on ownership like every other write here: the thread id is the only
 * thing the client supplies, so a member of one band must not be able to write
 * a cursor row against another band's thread and learn that it exists.
 */
export async function markBandThreadRead(
	threadId: string,
	groupId: string,
	userId: string
): Promise<void> {
	const [owned] = await db
		.select({ id: inboxThread.id })
		.from(inboxThread)
		.where(and(eq(inboxThread.id, threadId), ownedBy(groupId)))
		.limit(1);

	if (!owned) return;

	await db
		.insert(inboxGroupRead)
		.values({ threadId, userId, lastReadAt: new Date() })
		.onConflictDoUpdate({
			target: [inboxGroupRead.threadId, inboxGroupRead.userId],
			set: { lastReadAt: new Date() }
		});
}

/** Drives the "Messages" badge in the band nav. */
export async function countBandUnread(groupId: string, userId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxThread)
		.leftJoin(inboxGroupRead, readCursorOf(userId))
		.where(and(ownedBy(groupId), eq(inboxThread.status, 'open'), isUnread));
	return row?.count ?? 0;
}

/**
 * The band a thread belongs to, for the notification fan-out.
 *
 * Returns null for every thread that is not a band's, which is what keeps the
 * listener from trying to notify a roster that does not exist.
 */
export async function bandOfThread(threadId: string): Promise<string | null> {
	const [row] = await db
		.select({ groupId: inboxThread.groupId })
		.from(inboxThread)
		.where(and(eq(inboxThread.id, threadId), eq(inboxThread.channel, 'band')))
		.limit(1);
	return row?.groupId ?? null;
}
