import { db } from '$lib/server/db';
import { inboxThread, inboxMessage, inboxParticipant } from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { and, count, desc, eq, gt, inArray, isNull, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { PaginationInput } from '$lib/server/db/paginate';
import { paginate } from '$lib/server/db/paginate';
import { addPeerMessage } from './message-service';
import { markPortalThreadRead } from './portal-service';
import { updateStatus } from './thread-service';
import {
	isBlockedEitherWay,
	blockUser,
	messagingIsDisabled,
	acceptsDirectMessages
} from '$lib/server/moderation/moderation-service';
import { getStanding } from '$lib/server/moderation/standing-service';
import { allowRateLimited } from '$lib/server/rate-limit';
import { MAX_PENDING_SENT_REQUESTS, DIRECT_MESSAGE_BODY_MAX } from '$lib/config';

/**
 * Everything a signed-in member may do with a conversation between them and
 * another member.
 *
 * This file is a security boundary. Three rules hold for every function below
 * and must keep holding:
 *
 *  1. Ownership is enforced in the WHERE clause, via a join on
 *     `inbox_participant` — never by inspecting a row that has already been
 *     returned. Remote functions are the only guard in this app, and a guard
 *     that lives in the SQL cannot be forgotten at one call site.
 *  2. Nothing here reads `inbox_note`, and nothing here is reachable by staff.
 *     Staff read a direct thread through `getFlaggedDirectThread` only, which
 *     is keyed on a report rather than on a thread id.
 *  3. WHERE clause for anything that *selects* a row that already exists; a
 *     plain `if` only for preconditions on *creating* one. A block, a standing
 *     and a rate limit are all preconditions on a write — there is no row for
 *     them to filter — so those three, and only those, are guards.
 *
 * This is a sibling of `portal-service.ts` rather than an extension of it, and
 * the important reason is rule-shaped: `getPortalThread` masks the other
 * party's user id, because a member has no business learning staff ids. Here,
 * knowing who you are talking to is the entire feature. One file cannot hold
 * both rules without making the rule conditional, and conditional rules rot.
 */

/** Statuses a member may still write into. Resolved is final, as with portal. */
const WRITABLE_STATUS = 'open' as const;

/** Joins the thread to the caller's participation, which is the ownership check. */
function participantOf(userId: string) {
	return and(eq(inboxParticipant.threadId, inboxThread.id), eq(inboxParticipant.userId, userId));
}

const isUnread = or(
	isNull(inboxParticipant.lastReadAt),
	gt(inboxThread.lastMessageAt, inboxParticipant.lastReadAt)
);

/**
 * The other participant on this thread has accepted it.
 *
 * This is the single most important protection in the feature: until the
 * recipient accepts, a request is exactly one message. Not "one message and
 * then a nag", not "one message a day" — one, enforced here in SQL rather than
 * in an `if` somewhere a later refactor can drop.
 */
function counterpartAccepted(userId: string) {
	return sql`EXISTS (SELECT 1 FROM inbox_participant other
	                   WHERE other.thread_id = ${inboxThread.id}
	                     AND other.user_id <> ${userId}
	                     AND other.accepted_at IS NOT NULL)`;
}

/**
 * SQL for `messagingIsDisabled`, for the four places that need it inside a
 * WHERE clause rather than as a separate round-trip.
 *
 * Both halves matter and they live in different tables now: staff switching
 * someone off is `member_standing` scoped to `messaging`, while the member's own
 * switch is `user.accepts_direct_messages`. They used to be one row with a
 * `source` column, which is what `messaging_standing` was; #224 split it. These
 * predicates are raw `sql`, so nothing type-checked them and they kept naming
 * the dropped table for a day — every conversation list 500'd
 * (JAVASCRIPT-SVELTEKIT-2F/2G). Keep them here, once, rather than inline.
 *
 * A LEFT JOIN because absence of a standing row means good standing.
 */
function messagingDisabledFor(userIdExpr: SQL | AnyColumn) {
	return sql`EXISTS (SELECT 1 FROM "user" u
	                   LEFT JOIN member_standing ms ON ms.user_id = u.id
	                                               AND ms.scope = 'messaging'
	                   WHERE u.id = ${userIdExpr}
	                     AND (u.accepts_direct_messages = 0 OR ms.status = 'disabled'))`;
}

/** Nobody on this thread has messaging switched off. */
function neitherPartyDisabled() {
	return sql`NOT EXISTS (SELECT 1 FROM inbox_participant p
	                       WHERE p.thread_id = ${inboxThread.id}
	                         AND ${messagingDisabledFor(sql`p.user_id`)})`;
}

/** No block between the two people on this thread, in either direction. */
function noBlockBetweenParticipants() {
	return sql`NOT EXISTS (SELECT 1 FROM inbox_participant a
	                       JOIN inbox_participant b ON b.thread_id = a.thread_id
	                                               AND b.user_id <> a.user_id
	                       JOIN user_block ub ON ub.blocker_user_id = a.user_id
	                                         AND ub.blocked_user_id = b.user_id
	                       WHERE a.thread_id = ${inboxThread.id})`;
}

// ---------------------------------------------------------------------------
// Starting a conversation
// ---------------------------------------------------------------------------

export type StartDirectResult =
	| { status: 'sent' }
	| { status: 'restricted'; reason: string | null }
	| { status: 'rate_limited' }
	| { status: 'too_many_pending' };

/**
 * Every branch that silently drops a message returns this exact value.
 *
 * Blocked, self-addressed, deactivated recipient, hidden recipient, recipient
 * with messaging off — the sender must not be able to tell any of them apart,
 * or from success. That is what makes declining a request costless: a decline
 * and an unopened request look identical from the other side.
 *
 * Returned as a shared constant rather than five separate literals so that a
 * future "let's give a helpful error message here" change has to notice it is
 * breaking something deliberate.
 */
const SILENTLY_DROPPED: StartDirectResult = { status: 'sent' };

export interface StartDirectThreadParams {
	senderId: string;
	senderName: string;
	recipientId: string;
	body: string;
}

export async function startDirectThread(
	params: StartDirectThreadParams
): Promise<StartDirectResult> {
	const body = params.body.trim().slice(0, DIRECT_MESSAGE_BODY_MAX);
	if (!body) return SILENTLY_DROPPED;
	if (params.senderId === params.recipientId) return SILENTLY_DROPPED;

	// Deactivated members, and members who have taken themselves out of the
	// directory, are not reachable. Hidden is a statement about being found, and
	// we read it as covering being messaged too.
	const [recipient] = await db
		.select({ id: user.id, acceptsDirectMessages: user.acceptsDirectMessages })
		.from(user)
		.where(
			and(
				eq(user.id, params.recipientId),
				isNull(user.deletedAt),
				ne(user.directoryVisibility, 'hidden')
			)
		)
		.limit(1);
	if (!recipient) return SILENTLY_DROPPED;

	if (await isBlockedEitherWay(params.senderId, params.recipientId)) return SILENTLY_DROPPED;

	// A member with messaging switched off cannot be reached — whether they
	// switched it off or staff did. Same silent drop, and deliberately the same
	// one for both: which of the two it was is nobody else's business. The
	// preference rode along on the row above, so only the standing costs a query.
	if (!recipient.acceptsDirectMessages) return SILENTLY_DROPPED;
	if ((await getStanding(params.recipientId, 'messaging')).status === 'disabled') {
		return SILENTLY_DROPPED;
	}

	// The sender's own restriction is not silent — they are entitled to know why
	// they cannot write, and to be told what staff said about it. Their own switch
	// being off stops them too, with no reason to give: they already know.
	const senderStanding = await getStanding(params.senderId, 'messaging');
	if (senderStanding.status !== 'none') {
		return { status: 'restricted', reason: senderStanding.reason };
	}
	// The preference only — `messagingIsDisabled` would re-read the standing we
	// are already holding.
	if (!(await acceptsDirectMessages(params.senderId))) {
		return { status: 'restricted', reason: null };
	}

	// Counted in the database, so it is exactly true: you may not have more than
	// five people ignoring you at once. Clears itself as people accept or
	// decline, which a time window would not.
	if ((await countOutstandingSentRequests(params.senderId)) >= MAX_PENDING_SENT_REQUESTS) {
		return { status: 'too_many_pending' };
	}

	// KV-backed and only roughly accurate, so it is the backstop rather than the
	// limit. Note a *denied* hit does not extend the window — the counter only
	// advances on success — so hammering the button does not extend the lockout.
	if (!(await allowRateLimited(`dm-request:${params.senderId}`, 5, 86400))) {
		return { status: 'rate_limited' };
	}

	const [thread] = await db
		.insert(inboxThread)
		.values({ channel: 'direct', status: 'open' })
		.returning({ id: inboxThread.id });

	// The initiator has obviously consented; the recipient has not yet. That
	// asymmetry — one stamped row, one null — is the whole request mechanism.
	await db.insert(inboxParticipant).values([
		{ threadId: thread.id, userId: params.senderId, role: 'member', acceptedAt: new Date() },
		{ threadId: thread.id, userId: params.recipientId, role: 'member', acceptedAt: null }
	]);

	await addPeerMessage({
		threadId: thread.id,
		body,
		authorUserId: params.senderId,
		authorName: params.senderName,
		recipientUserId: params.recipientId,
		isRequest: true
	});

	// Their own message must not come back to them as unread.
	await markPortalThreadRead(thread.id, params.senderId);

	return { status: 'sent' };
}

// ---------------------------------------------------------------------------
// Replying, accepting, declining
// ---------------------------------------------------------------------------

/**
 * Returns null unless the caller is an accepted participant of a live direct
 * thread that the other party has also accepted, with no block and nobody
 * disabled — one answer for "not yours", "not a direct thread", "does not
 * exist", "still only a request", "blocked" and "closed", because the caller
 * should not be able to tell those apart.
 */
export async function replyToDirectThread(params: {
	threadId: string;
	userId: string;
	userName: string;
	body: string;
}): Promise<{ messageId: string } | null> {
	const body = params.body.trim().slice(0, DIRECT_MESSAGE_BODY_MAX);
	if (!body) return null;

	const [thread] = await db
		.select({ id: inboxThread.id })
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(params.userId))
		.where(
			and(
				eq(inboxThread.id, params.threadId),
				eq(inboxThread.channel, 'direct'),
				eq(inboxThread.status, WRITABLE_STATUS),
				isNotNull(inboxParticipant.acceptedAt),
				counterpartAccepted(params.userId),
				noBlockBetweenParticipants(),
				neitherPartyDisabled()
			)
		)
		.limit(1);

	if (!thread) return null;

	if (!(await allowRateLimited(`dm-send:${params.userId}`, 60, 3600))) return null;

	const other = await counterpartOf(params.threadId, params.userId);
	if (!other) return null;

	const message = await addPeerMessage({
		threadId: thread.id,
		body,
		authorUserId: params.userId,
		authorName: params.userName,
		recipientUserId: other,
		isRequest: false
	});

	await markPortalThreadRead(thread.id, params.userId);

	return { messageId: message.id };
}

/** Accept a pending request. Returns false when there is nothing to accept. */
export async function acceptDirectThread(threadId: string, userId: string): Promise<boolean> {
	if (await messagingIsDisabled(userId)) return false;

	const other = await counterpartOf(threadId, userId);
	if (!other) return false;
	if (await isBlockedEitherWay(userId, other)) return false;

	const updated = await db
		.update(inboxParticipant)
		.set({ acceptedAt: new Date() })
		.where(
			and(
				eq(inboxParticipant.threadId, threadId),
				eq(inboxParticipant.userId, userId),
				isNull(inboxParticipant.acceptedAt)
			)
		)
		.returning({ id: inboxParticipant.id });

	return updated.length > 0;
}

/**
 * Decline a pending request: close the conversation and block the sender.
 *
 * The block is what makes declining final — without it the same person could
 * open a fresh request tomorrow. The sender is never told; from their side this
 * is indistinguishable from a request nobody has opened yet.
 *
 * `reportDirectThread` does exactly this and files a flag as well, so the two
 * share this path. If they drift apart, they drift apart on who gets blocked.
 */
export async function declineDirectThread(threadId: string, userId: string): Promise<boolean> {
	const pending = await pendingRequestFor(threadId, userId);
	if (!pending) return false;

	await blockUser({
		blockerUserId: userId,
		blockedUserId: pending.senderId,
		source: 'declined_request'
	});
	await updateStatus(threadId, 'resolved');
	return true;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface DirectThreadSummary {
	id: string;
	status: (typeof inboxThread.$inferSelect)['status'];
	preview: string | null;
	messageCount: number;
	lastMessageAt: Date | null;
	createdAt: Date;
	unread: boolean;
	/** True while the caller has not accepted — shown in the list as a request. */
	pending: boolean;
	counterpartId: string | null;
	counterpartName: string | null;
}

/**
 * The caller's conversations, **including requests they have not accepted**.
 *
 * A request appears in the same list as everything else, tagged `pending`, so
 * it is there when the member goes to Messages rather than pulling them there.
 * The counterpart is what keeps it out of the unread count — see
 * `countDirectUnread`, which filters to accepted threads only.
 */
export async function listDirectThreads(userId: string, pagination: PaginationInput) {
	const other = alias(inboxParticipant, 'other_participant');
	const otherUser = alias(user, 'other_user');

	const where = and(
		eq(inboxThread.channel, 'direct'),
		eq(inboxParticipant.userId, userId),
		// A member who has switched messaging off disappears from the other
		// person's list. They keep their own history; nobody gets to keep writing
		// at someone who cannot answer.
		sql`NOT ${messagingDisabledFor(other.userId)}`
	);

	const dataQuery = db
		.select({
			id: inboxThread.id,
			status: inboxThread.status,
			preview: inboxThread.preview,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt,
			// SQLite has no boolean, so these come back as 0/1 and are mapped
			// after paginate — same shape as listPortalThreads.
			unread: sql<number>`CASE WHEN ${isUnread} THEN 1 ELSE 0 END`,
			pending: sql<number>`CASE WHEN ${inboxParticipant.acceptedAt} IS NULL THEN 1 ELSE 0 END`,
			counterpartId: other.userId,
			counterpartName: otherUser.name
		})
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(userId))
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.leftJoin(otherUser, eq(otherUser.id, other.userId))
		.where(where)
		.orderBy(desc(inboxThread.lastMessageAt))
		.$dynamic();

	const countQuery = db
		.select({ count: count() })
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(userId))
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.where(where);

	const result = await paginate(dataQuery, countQuery, pagination);
	return {
		...result,
		rows: result.rows.map((row) => ({
			...row,
			unread: row.unread === 1,
			pending: row.pending === 1
		}))
	};
}

/**
 * Every conversation a member is party to — staff threads and member threads in
 * one list, newest first.
 *
 * This works because both kinds are participant-based: a portal thread has one
 * participant row (the member), a direct thread has two. That is exactly what
 * `inbox_participant` was introduced for, and it means the Messages page needs
 * no client-side merge and no second pagination.
 *
 * Requests are included, tagged `pending`. They belong in the list — a member
 * should find one when they go to Messages — but `countDirectUnread` leaves
 * them out of the badge, so an unconsented message never follows anyone around
 * the site. Those two facts are a pair; changing one without the other either
 * hides requests or turns them into a nag.
 */
export async function listMemberConversations(userId: string, pagination: PaginationInput) {
	const other = alias(inboxParticipant, 'other_participant');
	const otherUser = alias(user, 'other_user');

	const where = and(
		inArray(inboxThread.channel, ['portal', 'direct']),
		eq(inboxParticipant.userId, userId),
		// A member who switched messaging off drops out of the other person's
		// list. Their own history stays; nobody keeps writing at someone who
		// cannot answer. Portal threads have no `other`, so this is vacuously true
		// for them.
		sql`NOT ${messagingDisabledFor(other.userId)}`
	);

	const dataQuery = db
		.select({
			id: inboxThread.id,
			channel: inboxThread.channel,
			subject: inboxThread.subject,
			status: inboxThread.status,
			preview: inboxThread.preview,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt,
			unread: sql<number>`CASE WHEN ${isUnread} THEN 1 ELSE 0 END`,
			pending: sql<number>`CASE WHEN ${inboxThread.channel} = 'direct'
			                           AND ${inboxParticipant.acceptedAt} IS NULL
			                          THEN 1 ELSE 0 END`,
			counterpartId: other.userId,
			counterpartName: otherUser.name
		})
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(userId))
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.leftJoin(otherUser, eq(otherUser.id, other.userId))
		.where(where)
		.orderBy(desc(inboxThread.lastMessageAt))
		.$dynamic();

	const countQuery = db
		.select({ count: count() })
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(userId))
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.where(where);

	const result = await paginate(dataQuery, countQuery, pagination);
	return {
		...result,
		rows: result.rows.map((row) => ({
			...row,
			unread: row.unread === 1,
			pending: row.pending === 1
		}))
	};
}

/**
 * One conversation, with its messages.
 *
 * Deliberately has **no `acceptedAt` condition**. A recipient has to be able to
 * read a pending request in order to decide on it — and in order to report it,
 * which is the whole reason Report sits next to Accept and Decline. Consent
 * gates the *write* and the *unread count*, not the read.
 *
 * Also deliberately does **not** mask the other party's `authorUserId`. That is
 * the opposite of `getPortalThread`, which nulls it so no staff ids reach a
 * member. Here the counterpart is another member and their identity is the
 * point — and the timeline needs it to put the right bubbles on the right side.
 */
export async function getDirectThread(threadId: string, userId: string) {
	const other = alias(inboxParticipant, 'other_participant');
	const otherUser = alias(user, 'other_user');

	const [thread] = await db
		.select({
			id: inboxThread.id,
			status: inboxThread.status,
			createdAt: inboxThread.createdAt,
			accepted: sql<number>`CASE WHEN ${inboxParticipant.acceptedAt} IS NOT NULL THEN 1 ELSE 0 END`,
			counterpartId: other.userId,
			counterpartName: otherUser.name,
			counterpartDeleted: sql<number>`CASE WHEN ${otherUser.deletedAt} IS NOT NULL THEN 1 ELSE 0 END`
		})
		.from(inboxThread)
		.innerJoin(inboxParticipant, participantOf(userId))
		.leftJoin(other, and(eq(other.threadId, inboxThread.id), ne(other.userId, userId)))
		.leftJoin(otherUser, eq(otherUser.id, other.userId))
		.where(
			and(
				eq(inboxThread.id, threadId),
				eq(inboxThread.channel, 'direct'),
				sql`NOT ${messagingDisabledFor(other.userId)}`
			)
		)
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
		.orderBy(inboxMessage.createdAt);

	const blocked = thread.counterpartId
		? await isBlockedEitherWay(userId, thread.counterpartId)
		: false;

	return {
		...thread,
		accepted: thread.accepted === 1,
		counterpartDeleted: thread.counterpartDeleted === 1,
		messages,
		viewerUserId: userId,
		blocked
	};
}

/** Drives the "Messages" badge. Accepted threads only — a request never nags. */
export async function countDirectUnread(userId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxParticipant)
		.innerJoin(inboxThread, eq(inboxThread.id, inboxParticipant.threadId))
		.where(
			and(
				eq(inboxParticipant.userId, userId),
				eq(inboxThread.channel, 'direct'),
				isNotNull(inboxParticipant.acceptedAt),
				isUnread
			)
		);
	return row?.count ?? 0;
}

/** How many requests are waiting for this member to decide. */
export async function countPendingRequests(userId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxParticipant)
		.innerJoin(inboxThread, eq(inboxThread.id, inboxParticipant.threadId))
		.where(
			and(
				eq(inboxParticipant.userId, userId),
				eq(inboxThread.channel, 'direct'),
				eq(inboxThread.status, 'open'),
				isNull(inboxParticipant.acceptedAt)
			)
		);
	return row?.count ?? 0;
}

/**
 * How many people are sitting on an unanswered request from this member.
 *
 * The exact, self-clearing half of the anti-spam pair: it falls as recipients
 * accept or decline, where a daily quota would not.
 */
export async function countOutstandingSentRequests(userId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxParticipant)
		.innerJoin(inboxThread, eq(inboxThread.id, inboxParticipant.threadId))
		.where(
			and(
				eq(inboxParticipant.userId, userId),
				eq(inboxThread.channel, 'direct'),
				eq(inboxThread.status, 'open'),
				isNotNull(inboxParticipant.acceptedAt),
				sql`EXISTS (SELECT 1 FROM inbox_participant other
				            WHERE other.thread_id = ${inboxThread.id}
				              AND other.user_id <> ${userId}
				              AND other.accepted_at IS NULL)`
			)
		);
	return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The other member on a thread the caller is genuinely part of. */
export async function counterpartOf(threadId: string, userId: string): Promise<string | null> {
	const other = alias(inboxParticipant, 'other_participant');
	const [row] = await db
		.select({ userId: other.userId })
		.from(inboxParticipant)
		.innerJoin(other, and(eq(other.threadId, inboxParticipant.threadId), ne(other.userId, userId)))
		.where(and(eq(inboxParticipant.threadId, threadId), eq(inboxParticipant.userId, userId)))
		.limit(1);
	return row?.userId ?? null;
}

/** The request awaiting this member's decision, if there is one. */
async function pendingRequestFor(
	threadId: string,
	userId: string
): Promise<{ senderId: string } | null> {
	const other = alias(inboxParticipant, 'other_participant');
	const [row] = await db
		.select({ senderId: other.userId })
		.from(inboxParticipant)
		.innerJoin(inboxThread, eq(inboxThread.id, inboxParticipant.threadId))
		.innerJoin(other, and(eq(other.threadId, inboxParticipant.threadId), ne(other.userId, userId)))
		.where(
			and(
				eq(inboxParticipant.threadId, threadId),
				eq(inboxParticipant.userId, userId),
				eq(inboxThread.channel, 'direct'),
				isNull(inboxParticipant.acceptedAt)
			)
		)
		.limit(1);
	return row ? { senderId: row.senderId } : null;
}
