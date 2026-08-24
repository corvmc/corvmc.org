import { db } from '$lib/server/db';
import {
	inboxThread,
	inboxMessage,
	inboxNote,
	inboxParticipant
} from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	eq,
	ne,
	and,
	desc,
	count,
	like,
	or,
	inArray,
	isNull,
	isNotNull,
	lte,
	sql
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { InboxChannel, InboxThreadStatus } from '$lib/server/db/schema/inbox';
import type { PaginationInput } from '$lib/server/db/paginate';
import { paginate } from '$lib/server/db/paginate';

/**
 * The one expression that keeps private member↔member conversations out of
 * every staff view.
 *
 * A `direct` thread is nobody's business but its two participants' — it is not
 * the org talking to the outside world, and staff have no queue role in it. It
 * becomes visible only by being reported, and drops back out when the report is
 * resolved.
 *
 * **If a query in this file reads `inbox_thread` and does not use this, it is a
 * leak.** That includes the aggregates: an unfiltered COUNT puts live DMs in the
 * staff badge, and `listThreads`' search does a LIKE over `preview`, which for a
 * direct thread is a member's private text.
 */
export const staffVisibleThread = or(
	ne(inboxThread.channel, 'direct'),
	sql`EXISTS (SELECT 1 FROM content_flag cf
	            WHERE cf.entity_type = 'inbox_thread'
	              AND cf.entity_id = ${inboxThread.id}
	              AND cf.status = 'pending')`
)!;

const PREVIEW_LENGTH = 200;

export function truncatePreview(text: string): string {
	if (text.length <= PREVIEW_LENGTH) return text;
	return text.slice(0, PREVIEW_LENGTH) + '…';
}

export interface FindOrCreateThreadParams {
	channel: InboxChannel;
	contactName?: string | null;
	contactEmail?: string | null;
	contactPhone?: string | null;
	contactExternalId?: string | null;
	subject?: string | null;
}

export async function findOrCreateThread(params: FindOrCreateThreadParams) {
	const { channel, contactName, contactEmail, contactPhone, contactExternalId, subject } = params;

	let existing: typeof inboxThread.$inferSelect | undefined;

	if (channel === 'email' && contactEmail) {
		[existing] = await db
			.select()
			.from(inboxThread)
			.where(
				and(
					eq(inboxThread.channel, 'email'),
					eq(inboxThread.contactEmail, contactEmail),
					inArray(inboxThread.status, ['open', 'snoozed'])
				)
			)
			.orderBy(desc(inboxThread.lastMessageAt))
			.limit(1);
	} else if (channel === 'sms' && contactPhone) {
		[existing] = await db
			.select()
			.from(inboxThread)
			.where(
				and(
					eq(inboxThread.channel, 'sms'),
					eq(inboxThread.contactPhone, contactPhone),
					inArray(inboxThread.status, ['open', 'snoozed'])
				)
			)
			.orderBy(desc(inboxThread.lastMessageAt))
			.limit(1);
	} else if ((channel === 'instagram' || channel === 'messenger') && contactExternalId) {
		[existing] = await db
			.select()
			.from(inboxThread)
			.where(
				and(
					eq(inboxThread.channel, channel),
					eq(inboxThread.contactExternalId, contactExternalId),
					inArray(inboxThread.status, ['open', 'snoozed'])
				)
			)
			.orderBy(desc(inboxThread.lastMessageAt))
			.limit(1);
	}
	// 'web' and 'portal' always create a new thread. Both address a conversation
	// explicitly — the contact form is one-shot, and a portal member picks a
	// subject and replies into a thread by id — so folding a second one into an
	// open thread would silently discard its subject.

	if (existing) return existing;

	const [thread] = await db
		.insert(inboxThread)
		.values({
			channel,
			contactName: contactName ?? null,
			contactEmail: contactEmail ?? null,
			contactPhone: contactPhone ?? null,
			contactExternalId: contactExternalId ?? null,
			subject: subject ?? null
		})
		.returning();

	return thread;
}

/** Bare thread row by id — used by inbound routing, which needs the thread's
 *  channel/status/contact fields but not its messages or notes. */
export async function findThreadById(id: string) {
	const [thread] = await db.select().from(inboxThread).where(eq(inboxThread.id, id)).limit(1);
	return thread;
}

/**
 * Reopen a thread when a contact replies to it. `findOrCreateThread` provides
 * this implicitly for new threads (it only matches open/snoozed rows), but the
 * MailboxHash path resolves a thread directly and bypasses that filter.
 */
export async function reopenThread(threadId: string) {
	await db
		.update(inboxThread)
		.set({ status: 'open', snoozedUntil: null, awaitingReplySince: null, updatedAt: new Date() })
		.where(eq(inboxThread.id, threadId));
}

export interface ListThreadsFilters {
	status?: InboxThreadStatus;
	channel?: InboxChannel;
	assignedToUserId?: string | null;
	/** True: waiting on the contact. False: waiting on us. Undefined: both. */
	awaitingReply?: boolean;
	search?: string;
}

/**
 * The staff queue. Every channel here is the org talking to the outside world,
 * so there is deliberately no ownership filter.
 *
 * This is the single enforcement point for thread visibility: if a channel is
 * ever added whose threads are private to their participants (member-to-member
 * messages), its exclusion belongs in `conditions` below, alongside whatever
 * escalates a reported thread back into the queue.
 */
export async function listThreads(filters: ListThreadsFilters, pagination: PaginationInput) {
	// Unconditional, and first: behind an `if` it would be one refactor away from
	// only applying when some filter happens to be set.
	const conditions: (SQL | undefined)[] = [staffVisibleThread];

	if (filters.status) conditions.push(eq(inboxThread.status, filters.status));
	if (filters.channel) conditions.push(eq(inboxThread.channel, filters.channel));
	if (filters.assignedToUserId !== undefined) {
		if (filters.assignedToUserId === null) {
			conditions.push(sql`${inboxThread.assignedToUserId} IS NULL`);
		} else {
			conditions.push(eq(inboxThread.assignedToUserId, filters.assignedToUserId));
		}
	}
	if (filters.awaitingReply !== undefined) {
		conditions.push(
			filters.awaitingReply
				? isNotNull(inboxThread.awaitingReplySince)
				: isNull(inboxThread.awaitingReplySince)
		);
	}
	if (filters.search) {
		const pattern = `%${filters.search}%`;
		conditions.push(
			or(
				like(inboxThread.contactName, pattern),
				like(inboxThread.contactEmail, pattern),
				like(inboxThread.subject, pattern),
				like(inboxThread.preview, pattern)
			)
		);
	}

	const where = and(...conditions);

	const dataQuery = db
		.select({
			id: inboxThread.id,
			channel: inboxThread.channel,
			status: inboxThread.status,
			subject: inboxThread.subject,
			preview: inboxThread.preview,
			contactName: inboxThread.contactName,
			contactEmail: inboxThread.contactEmail,
			contactPhone: inboxThread.contactPhone,
			assignedToUserId: inboxThread.assignedToUserId,
			assignedToName: user.name,
			awaitingReplySince: inboxThread.awaitingReplySince,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt
		})
		.from(inboxThread)
		.leftJoin(user, eq(inboxThread.assignedToUserId, user.id))
		.where(where)
		.orderBy(desc(inboxThread.lastMessageAt))
		.$dynamic();

	const countQuery = db.select({ count: count() }).from(inboxThread).where(where);

	return paginate(dataQuery, countQuery, pagination);
}

/**
 * The staff detail read: thread, every message, and the staff-only notes.
 *
 * There is no ownership check here and there does not need to be — every other
 * channel is the org's own correspondence. `direct` is the exception, so it is
 * refused outright. That one line is what stops a staff member reading a
 * private conversation by knowing its id, and it covers three endpoints at
 * once: the detail page, the reply box and the note box all go through here.
 *
 * A reported conversation is read through `getFlaggedDirectThread`, which is
 * keyed on the flag rather than the thread — so the report is the only handle
 * staff ever have on a DM.
 */
export async function getThread(id: string) {
	// Refused before any message or note is fetched, not filtered afterwards.
	const [visible] = await db
		.select({ channel: inboxThread.channel })
		.from(inboxThread)
		.where(eq(inboxThread.id, id))
		.limit(1);
	if (!visible || visible.channel === 'direct') return null;

	// The member behind a portal thread, if there is one. Joined live rather than
	// read off the thread's denormalized contactName, which goes stale the moment
	// they rename themselves.
	//
	// Filtered to role='member' and safe because of the guard above: a direct
	// thread has two member participants and would multiply rows here.
	const contactUser = alias(user, 'contact_user');

	const [thread] = await db
		.select({
			id: inboxThread.id,
			channel: inboxThread.channel,
			status: inboxThread.status,
			subject: inboxThread.subject,
			contactName: inboxThread.contactName,
			contactEmail: inboxThread.contactEmail,
			contactPhone: inboxThread.contactPhone,
			contactExternalId: inboxThread.contactExternalId,
			assignedToUserId: inboxThread.assignedToUserId,
			assignedToName: user.name,
			contactUserId: contactUser.id,
			contactUserName: contactUser.name,
			snoozedUntil: inboxThread.snoozedUntil,
			awaitingReplySince: inboxThread.awaitingReplySince,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt
		})
		.from(inboxThread)
		.leftJoin(user, eq(inboxThread.assignedToUserId, user.id))
		.leftJoin(
			inboxParticipant,
			and(eq(inboxParticipant.threadId, inboxThread.id), eq(inboxParticipant.role, 'member'))
		)
		.leftJoin(contactUser, eq(contactUser.id, inboxParticipant.userId))
		.where(eq(inboxThread.id, id))
		.limit(1);

	if (!thread) return null;

	const messages = await db
		.select()
		.from(inboxMessage)
		.where(eq(inboxMessage.threadId, id))
		.orderBy(inboxMessage.createdAt);

	const notes = await db
		.select({
			id: inboxNote.id,
			threadId: inboxNote.threadId,
			authorUserId: inboxNote.authorUserId,
			authorName: user.name,
			body: inboxNote.body,
			createdAt: inboxNote.createdAt
		})
		.from(inboxNote)
		.leftJoin(user, eq(inboxNote.authorUserId, user.id))
		.where(eq(inboxNote.threadId, id))
		.orderBy(inboxNote.createdAt);

	return { ...thread, messages, notes };
}

export async function assignThread(threadId: string, userId: string | null) {
	await db
		.update(inboxThread)
		.set({ assignedToUserId: userId, updatedAt: new Date() })
		.where(eq(inboxThread.id, threadId));
}

export async function updateStatus(
	threadId: string,
	status: InboxThreadStatus,
	snoozedUntil?: Date
) {
	await db
		.update(inboxThread)
		.set({
			status,
			snoozedUntil: status === 'snoozed' ? (snoozedUntil ?? null) : null,
			// An explicit status move supersedes the awaiting marker: resolving ends
			// the wait, snoozing replaces it with a dated one, and reopening is staff
			// saying this needs an answer now.
			awaitingReplySince: null,
			updatedAt: new Date()
		})
		.where(eq(inboxThread.id, threadId));
}

/**
 * Mark a thread as waiting on its contact, or hand it back to the queue.
 *
 * Replying already does this (see `addOutboundMessage`); this is the manual
 * path, for a conversation answered somewhere the inbox cannot see — a phone
 * call, a hallway conversation, a text from someone's own phone.
 */
export async function setAwaitingReply(threadId: string, awaiting: boolean) {
	await db
		.update(inboxThread)
		.set({ awaitingReplySince: awaiting ? new Date() : null, updatedAt: new Date() })
		.where(eq(inboxThread.id, threadId));
}

/**
 * The staff nav badge. Open threads *waiting on us* — a thread we have already
 * answered is somebody else's move, so it drops out of this number even though
 * it is still open and still listed under the Open tab.
 *
 * This is why the badge and the Open tab count differ, and why they should:
 * the tab labels a list, the badge counts work.
 */
export async function getUnresolvedCount(): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxThread)
		.where(
			and(
				eq(inboxThread.status, 'open'),
				isNull(inboxThread.awaitingReplySince),
				staffVisibleThread
			)
		);
	return row?.count ?? 0;
}

export type ThreadStatusCounts = Record<InboxThreadStatus, number> & { all: number };

/**
 * Thread totals per status, for the badges on the list page's status tabs. One
 * grouped query rather than one count per tab.
 */
export async function countThreadsByStatus(): Promise<ThreadStatusCounts> {
	const rows = await db
		.select({ status: inboxThread.status, count: count() })
		.from(inboxThread)
		.where(staffVisibleThread)
		.groupBy(inboxThread.status);

	const counts = { open: 0, resolved: 0, snoozed: 0, all: 0 } satisfies ThreadStatusCounts;
	for (const row of rows) {
		counts[row.status] = row.count;
		counts.all += row.count;
	}
	return counts;
}

/**
 * Return every snoozed thread whose snooze has elapsed to the open queue. Run
 * from /api/cron/wake-snoozed; without it a snooze is indistinguishable from
 * deleting the thread.
 *
 * Rows with a null `snoozedUntil` are left alone — those were snoozed without a
 * date and are only reopened by hand or by an inbound reply.
 */
export async function wakeSnoozedThreads(now: Date = new Date()): Promise<{ woken: number }> {
	const due = and(
		eq(inboxThread.status, 'snoozed'),
		isNotNull(inboxThread.snoozedUntil),
		lte(inboxThread.snoozedUntil, now)
	);

	const rows = await db.select({ id: inboxThread.id }).from(inboxThread).where(due);
	if (rows.length === 0) return { woken: 0 };

	await db
		.update(inboxThread)
		.set({ status: 'open', snoozedUntil: null, updatedAt: now })
		.where(due);

	return { woken: rows.length };
}

/**
 * Threads whose external contact is this email address.
 *
 * Distinct from `listPortalThreads`, which finds threads a member is a
 * *participant* of. Someone who emailed the club or used the contact form
 * before they ever signed in has no participant row, so their correspondence is
 * invisible on their member record without this. Matching is on the
 * denormalized `contactEmail`, which is the only link that exists.
 */
export async function listThreadsByContactEmail(email: string, pagination: PaginationInput) {
	// staffVisibleThread even though a direct thread has no contactEmail to match
	// on. Relying on that would make this safe by accident: the day anyone
	// denormalises an address onto a direct thread — for search, for a digest —
	// this would start showing a member's private preview on the staff user page,
	// and nothing here would look wrong. Cheap to state, expensive to rediscover.
	const where = and(eq(inboxThread.contactEmail, email), staffVisibleThread);

	const dataQuery = db
		.select({
			id: inboxThread.id,
			channel: inboxThread.channel,
			status: inboxThread.status,
			subject: inboxThread.subject,
			preview: inboxThread.preview,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt
		})
		.from(inboxThread)
		.where(where)
		.orderBy(desc(inboxThread.lastMessageAt))
		.$dynamic();

	const countQuery = db.select({ count: count() }).from(inboxThread).where(where);

	return paginate(dataQuery, countQuery, pagination);
}
