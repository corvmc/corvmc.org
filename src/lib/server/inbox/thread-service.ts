import { db } from '$lib/server/db';
import {
	inboxThread,
	inboxMessage,
	inboxNote,
	inboxParticipant,
	inboxThreadTag
} from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	eq,
	ne,
	and,
	asc,
	desc,
	count,
	like,
	or,
	inArray,
	isNull,
	isNotNull,
	lte,
	notInArray,
	sql
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { InboxChannel, InboxThreadStatus } from '$lib/server/db/schema/inbox';
import type { PaginationInput } from '$lib/server/db/paginate';
import { paginate } from '$lib/server/db/paginate';
import { z } from 'zod';
import { contactSubjects, inboxThreadStatuses } from '$lib/config';
import type { InboxView } from '$lib/config';

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

/**
 * The moment the clock started on a conversation — what "waiting longest" is
 * measured from, and the queue's default sort key.
 *
 * `awaitingReplySince` first: once we have answered, the wait that matters is
 * theirs, and it starts at our reply rather than at their last message.
 * Otherwise the last message, and for a thread that somehow has none, its
 * creation. The column is never null, so the sort is total.
 *
 * Exported because the same expression has to order the list, filter it
 * ("waiting longer than N days") and colour the age chip. Three hand-written
 * copies of a COALESCE is three chances to disagree about what waiting means.
 */
export const waitingSince = sql<number>`coalesce(${inboxThread.awaitingReplySince}, ${inboxThread.lastMessageAt}, ${inboxThread.createdAt})`;

/**
 * Open *and waiting on us* — the Open view and the staff nav badge, which are
 * now the same number by construction rather than by coincidence.
 *
 * A thread we have already answered is somebody else's move. It is still open,
 * still live, and still listed — under Snoozed, with everything else parked.
 */
export const needsUsCondition = and(
	eq(inboxThread.status, 'open'),
	isNull(inboxThread.awaitingReplySince)
)!;

/**
 * Parked — out of the queue on a timer, and coming back on its own. A thread
 * snoozed until Tuesday and one waiting on a contact's reply are the same
 * proposition to whoever is working the queue, so they are one view.
 *
 * The marker is read only on an *open* row, which is the rule the counts follow
 * too. `addOutboundMessage` leaves one on a snoozed thread — harmless, the
 * first branch already has it — and `undoLastDisposition` can restore a stale
 * one onto a resolved thread. Neither may pull a conversation out of the status
 * it is actually in.
 *
 * The exact complement of {@link needsUsCondition} within open and snoozed,
 * which is what makes Open / Snoozed / Resolved a partition rather than three
 * overlapping filters.
 */
export const parkedCondition = or(
	eq(inboxThread.status, 'snoozed'),
	and(eq(inboxThread.status, 'open'), isNotNull(inboxThread.awaitingReplySince))
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

/**
 * Name a thread whose contact arrived as an opaque id.
 *
 * The Meta channels identify a contact by PSID/IGSID, so a thread starts life
 * titled with a seventeen-digit number and only gets a name once the profile
 * lookup comes back. Deliberately does nothing when the name is already set:
 * the lookup runs on first contact, and a later one overwriting a name staff
 * may have corrected by hand is a worse outcome than a stale one.
 */
export async function setThreadContactName(threadId: string, contactName: string) {
	await db
		.update(inboxThread)
		.set({ contactName, updatedAt: new Date() })
		.where(and(eq(inboxThread.id, threadId), isNull(inboxThread.contactName)));
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
	/**
	 * Which half of the live queue. `needs-us` is open and unanswered; `parked`
	 * is snoozed-or-awaiting. Undefined is both, plus resolved.
	 *
	 * One field rather than a status equality plus a marker flag, because
	 * `parked` is not expressible as an AND of those two columns — see
	 * {@link parkedCondition}.
	 */
	queue?: 'needs-us' | 'parked';
	search?: string;
	/**
	 * An inquiry type from `contactSubjects`, or the sentinel `other` for a
	 * thread whose subject is free text or absent — email and SMS threads, which
	 * never went through the contact form.
	 */
	subject?: string;
	/** Only threads that have been waiting at least this many days. */
	waitingAtLeastDays?: number;
	/**
	 * `waiting` puts whoever has been waiting longest at the top — the order the
	 * queue is meant to be worked in. `recent` is the old newest-first order,
	 * which is what Resolved and All want: nobody is waiting on those.
	 */
	sort?: 'waiting' | 'recent';
}

/**
 * Every filter the queue understands, as one predicate.
 *
 * This is the single enforcement point for thread visibility: if a channel is
 * ever added whose threads are private to their participants (member-to-member
 * messages), its exclusion belongs in `conditions` below, alongside whatever
 * escalates a reported thread back into the queue.
 *
 * Shared with `countThreadFacets`, which has to count the same rows the list
 * shows or the number beside an option is a promise the list does not keep.
 * `omit` drops one facet so a group can count its own options against
 * everything *else* that is selected — a status count computed with the status
 * filter still applied would only ever report the selected one.
 */
function threadConditions(
	filters: ListThreadsFilters,
	omit?: 'status' | 'subject' | 'assignee'
): SQL | undefined {
	// Unconditional, and first: behind an `if` it would be one refactor away from
	// only applying when some filter happens to be set.
	const conditions: (SQL | undefined)[] = [staffVisibleThread];

	if (filters.status && omit !== 'status') conditions.push(eq(inboxThread.status, filters.status));
	// The same facet as `status`, so `omit: 'status'` drops both: a status count
	// computed under the view it belongs to could only ever report itself.
	if (filters.queue && omit !== 'status') {
		conditions.push(filters.queue === 'parked' ? parkedCondition : needsUsCondition);
	}
	if (filters.channel) conditions.push(eq(inboxThread.channel, filters.channel));
	if (filters.assignedToUserId !== undefined && omit !== 'assignee') {
		if (filters.assignedToUserId === null) {
			conditions.push(sql`${inboxThread.assignedToUserId} IS NULL`);
		} else {
			conditions.push(eq(inboxThread.assignedToUserId, filters.assignedToUserId));
		}
	}
	if (filters.subject && omit !== 'subject') {
		conditions.push(
			filters.subject === 'other'
				? or(isNull(inboxThread.subject), notInArray(inboxThread.subject, [...contactSubjects]))
				: eq(inboxThread.subject, filters.subject)
		);
	}
	if (filters.waitingAtLeastDays !== undefined) {
		// Against the same expression the list is ordered by, so "waiting longer
		// than 3 days" hides exactly the rows below the 3d mark in the chip.
		conditions.push(lte(waitingSince, sql`unixepoch() - ${filters.waitingAtLeastDays * 86_400}`));
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

	return and(...conditions);
}

/**
 * The staff queue. Every channel here is the org talking to the outside world,
 * so there is deliberately no ownership filter.
 */
export async function listThreads(filters: ListThreadsFilters, pagination: PaginationInput) {
	const where = threadConditions(filters);

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
			// Both feed `openReason()` on the client — see thread-status.ts. Sent as
			// columns rather than a computed reason so the list can also show how
			// long, and so the rule lives in one place shared with the thread page.
			snoozedUntil: inboxThread.snoozedUntil,
			lastOutboundAt: inboxThread.lastOutboundAt,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			createdAt: inboxThread.createdAt
		})
		.from(inboxThread)
		.leftJoin(user, eq(inboxThread.assignedToUserId, user.id))
		.where(where)
		// Ascending on the wait clock is longest-waiting-first: the oldest
		// timestamp is the person who has been ignored longest.
		.orderBy(filters.sort === 'recent' ? desc(inboxThread.lastMessageAt) : asc(waitingSince))
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
			lastOutboundAt: inboxThread.lastOutboundAt,
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

/**
 * The four fields a disposition moves, captured from the row's *current* values
 * as part of the very UPDATE that changes them.
 *
 * SQL rather than a read-then-write pair: on D1 there is no transaction to hold
 * the two together (`db.transaction()` is broken), so a separate SELECT leaves a
 * window in which the thread has moved and its undo has not been recorded.
 * `json_object` reads the pre-update values because SQLite evaluates the whole
 * SET list against the old row.
 *
 * Timestamps go out as unix seconds, which is how they are stored — `undoValue`
 * turns them back into Dates on the way in.
 */
const undoSnapshot = sql`json_object(
	'status', ${inboxThread.status},
	'snoozedUntil', ${inboxThread.snoozedUntil},
	'awaitingReplySince', ${inboxThread.awaitingReplySince},
	'assignedToUserId', ${inboxThread.assignedToUserId}
)`;

/** What `undo_state` holds. Validated on read — it is JSON in a text column. */
const undoStateSchema = z.object({
	status: z.enum(inboxThreadStatuses),
	snoozedUntil: z.number().nullable(),
	awaitingReplySince: z.number().nullable(),
	assignedToUserId: z.string().nullable()
});

/**
 * Everything the details strip shows that is not on the thread row itself.
 *
 * Its own function rather than more joins in `getThread`, because none of it is
 * needed to read the conversation: the strip is collapsed by default, and this
 * is loaded where it is rendered so the thread paints without waiting on four
 * more tables.
 */
export async function getThreadContext(id: string) {
	const [thread] = await db
		.select({
			contactEmail: inboxThread.contactEmail,
			channel: inboxThread.channel,
			createdAt: inboxThread.createdAt
		})
		.from(inboxThread)
		.where(and(eq(inboxThread.id, id), staffVisibleThread))
		.limit(1);

	// Same refusal as getThread: a direct thread has no staff-facing context
	// because it has no staff-facing anything.
	if (!thread) return null;

	const [priorRows, firstRows, tags] = await Promise.all([
		// Other conversations with the same person. Matched on the denormalized
		// contact address, which is the only link that exists for someone who has
		// never had an account.
		thread.contactEmail
			? db
					.select({ count: count() })
					.from(inboxThread)
					.where(
						and(
							eq(inboxThread.contactEmail, thread.contactEmail),
							ne(inboxThread.id, id),
							staffVisibleThread
						)
					)
			: Promise.resolve([{ count: 0 }]),
		thread.contactEmail
			? db
					.select({ first: sql<number>`min(${inboxThread.createdAt})` })
					.from(inboxThread)
					.where(and(eq(inboxThread.contactEmail, thread.contactEmail), staffVisibleThread))
			: Promise.resolve([{ first: null }]),
		db
			.select({ tag: inboxThreadTag.tag })
			.from(inboxThreadTag)
			.where(eq(inboxThreadTag.threadId, id))
			.orderBy(asc(inboxThreadTag.tag))
	]);

	const first = firstRows[0]?.first;
	return {
		priorConversations: priorRows[0]?.count ?? 0,
		// The whole correspondence, not this thread: "first contact" means the
		// first time this person wrote to us at all.
		firstContactAt: first ? new Date(first * 1000) : thread.createdAt,
		tags: tags.map((t) => t.tag)
	};
}

/** Adding a tag the thread already carries is a no-op — see the unique index. */
export async function addThreadTag(threadId: string, tag: string) {
	await db.insert(inboxThreadTag).values({ threadId, tag }).onConflictDoNothing();
}

export async function removeThreadTag(threadId: string, tag: string) {
	await db
		.delete(inboxThreadTag)
		.where(and(eq(inboxThreadTag.threadId, threadId), eq(inboxThreadTag.tag, tag)));
}

export async function assignThread(threadId: string, userId: string | null) {
	await db
		.update(inboxThread)
		.set({ assignedToUserId: userId, undoState: undoSnapshot, updatedAt: new Date() })
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
			undoState: undoSnapshot,
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
		.set({
			awaitingReplySince: awaiting ? new Date() : null,
			undoState: undoSnapshot,
			updatedAt: new Date()
		})
		.where(eq(inboxThread.id, threadId));
}

/**
 * Put the thread back the way the last disposition found it.
 *
 * Returns false when there is nothing to undo, which is the ordinary outcome of
 * pressing ⌘Z twice: undo is one step deep by design, and the snapshot is
 * cleared as it is spent. The restore does *not* leave a new snapshot behind —
 * undoing an undo is just doing the thing again.
 */
export async function undoLastDisposition(threadId: string): Promise<boolean> {
	const [row] = await db
		.select({ undoState: inboxThread.undoState })
		.from(inboxThread)
		.where(eq(inboxThread.id, threadId))
		.limit(1);

	const parsed = undoStateSchema.safeParse(row?.undoState);
	if (!parsed.success) return false;

	const { status, snoozedUntil, awaitingReplySince, assignedToUserId } = parsed.data;
	await db
		.update(inboxThread)
		.set({
			status,
			snoozedUntil: snoozedUntil === null ? null : new Date(snoozedUntil * 1000),
			awaitingReplySince: awaitingReplySince === null ? null : new Date(awaitingReplySince * 1000),
			assignedToUserId,
			undoState: null,
			updatedAt: new Date()
		})
		.where(eq(inboxThread.id, threadId));

	return true;
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
		.where(and(needsUsCondition, staffVisibleThread));
	return row?.count ?? 0;
}

/**
 * The four views the queue offers, as numbers. `Record<InboxView, number>` so a
 * tab can never exist without a count, nor a count without a tab.
 *
 * `snoozed` covers both kinds of parked, which is why this still groups by the
 * awaiting marker as well as the status: an open row carrying it belongs under
 * Snoozed, and a resolved row carrying a stale one does not. `open` is exactly
 * {@link getUnresolvedCount}: the tab and the nav badge are the same claim, so
 * they had better be the same arithmetic.
 */
export type ThreadStatusCounts = Record<InboxView, number>;

export async function countThreadsByStatus(): Promise<ThreadStatusCounts> {
	const rows = await db
		.select({
			status: inboxThread.status,
			// A 0/1 flag rather than the timestamp — grouping by the raw column
			// would return one row per distinct instant.
			awaiting: sql<number>`(${inboxThread.awaitingReplySince} is not null)`,
			count: count()
		})
		.from(inboxThread)
		.where(staffVisibleThread)
		.groupBy(inboxThread.status, sql`(${inboxThread.awaitingReplySince} is not null)`);

	const counts: ThreadStatusCounts = { open: 0, snoozed: 0, resolved: 0, all: 0 };
	for (const row of rows) {
		// The marker only means anything on an open thread, and where it is there
		// the thread is parked exactly like a snoozed one. Every other status wins
		// over it — a stale marker must not move a resolved thread's count, and
		// `parkedCondition` excludes the same row for the same reason.
		if (row.status === 'open') counts[row.awaiting ? 'snoozed' : 'open'] += row.count;
		else counts[row.status] += row.count;
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
 *
 * `snoozedUntil` is deliberately *kept* on the way out. An open thread with a
 * snooze date in the past is a thread that came back on its own, and the queue
 * says so — "Snooze expired" is a different reason to be looking at a
 * conversation than "they replied". Everything that moves the thread on from
 * there clears the date: `updateStatus`, `reopenThread`, and a later snooze.
 */
export async function wakeSnoozedThreads(now: Date = new Date()): Promise<{ woken: number }> {
	const due = and(
		eq(inboxThread.status, 'snoozed'),
		isNotNull(inboxThread.snoozedUntil),
		lte(inboxThread.snoozedUntil, now)
	);

	const rows = await db.select({ id: inboxThread.id }).from(inboxThread).where(due);
	if (rows.length === 0) return { woken: 0 };

	await db.update(inboxThread).set({ status: 'open', updatedAt: now }).where(due);

	return { woken: rows.length };
}

/**
 * What each filter option would leave on screen, counted under everything else
 * that is currently selected.
 *
 * The panel updates live and has no Apply step, so a count here is a promise:
 * pick this and you will see that many. Each group is therefore counted with
 * its *own* facet dropped — a status count computed with the status filter
 * still applied could only ever report the option already chosen.
 *
 * Four queries rather than one. They are counts over an indexed table on the
 * server, and the alternative — a single grouped query — cannot express
 * "everything else but this facet" for more than one facet at a time.
 */
export type ThreadFacetCounts = {
	/** Rows the current filters leave. */
	matching: number;
	/** Rows the *view* holds, ignoring every filter. The "N of M shown" line. */
	total: number;
	status: ThreadStatusCounts;
	/** Keyed by `contactSubjects` value, plus `other`. */
	subject: Record<string, number>;
};

export async function countThreadFacets(filters: ListThreadsFilters): Promise<ThreadFacetCounts> {
	const [matching, total, statusRows, subjectRows] = await Promise.all([
		db.select({ count: count() }).from(inboxThread).where(threadConditions(filters)),
		db.select({ count: count() }).from(inboxThread).where(staffVisibleThread),
		db
			.select({
				status: inboxThread.status,
				awaiting: sql<number>`(${inboxThread.awaitingReplySince} is not null)`,
				count: count()
			})
			.from(inboxThread)
			.where(threadConditions(filters, 'status'))
			.groupBy(inboxThread.status, sql`(${inboxThread.awaitingReplySince} is not null)`),
		db
			.select({ subject: inboxThread.subject, count: count() })
			.from(inboxThread)
			.where(threadConditions(filters, 'subject'))
			.groupBy(inboxThread.subject)
	]);

	const status: ThreadStatusCounts = { open: 0, snoozed: 0, resolved: 0, all: 0 };
	for (const row of statusRows) {
		if (row.status === 'open') status[row.awaiting ? 'snoozed' : 'open'] += row.count;
		else status[row.status] += row.count;
		status.all += row.count;
	}

	// Anything not in the contact form's vocabulary is one bucket. Email and SMS
	// threads carry a free-text subject or none, and listing each distinct one
	// would turn a facet into a list of individual conversations.
	const known = new Set<string>(contactSubjects);
	const subject: Record<string, number> = { other: 0 };
	for (const s of contactSubjects) subject[s] = 0;
	for (const row of subjectRows) {
		if (row.subject && known.has(row.subject)) subject[row.subject] += row.count;
		else subject.other += row.count;
	}

	return { matching: matching[0]?.count ?? 0, total: total[0]?.count ?? 0, status, subject };
}

/**
 * What a Daily session would cover, and why each thread is in it.
 *
 * A scoped set, not the whole queue. Everything here is open and waiting on us
 * — the Open view — but the breakdown is the point: "4 you never answered, 2
 * that came back from a snooze, 1 that has been waiting over a week" is a
 * different proposition from "11 conversations", and it is the one that makes a
 * session feel finishable.
 *
 * The three reasons overlap and are counted in the same precedence
 * `openReason()` uses, so the numbers sum to the total rather than double
 * counting a snoozed thread that was also never answered.
 */
export type DailyScope = {
	threadIds: string[];
	unanswered: number;
	replied: number;
	returned: number;
	/** Overlaps the three above — an age cut across them, not a fourth kind. */
	longWaiting: number;
};

export async function getDailyScope(now: Date = new Date()): Promise<DailyScope> {
	const rows = await db
		.select({
			id: inboxThread.id,
			snoozedUntil: inboxThread.snoozedUntil,
			lastOutboundAt: inboxThread.lastOutboundAt,
			lastMessageAt: inboxThread.lastMessageAt,
			waitingSince
		})
		.from(inboxThread)
		.where(and(needsUsCondition, staffVisibleThread))
		.orderBy(asc(waitingSince));

	const scope: DailyScope = {
		threadIds: [],
		unanswered: 0,
		replied: 0,
		returned: 0,
		longWaiting: 0
	};
	const weekAgo = now.getTime() - 7 * 86_400_000;

	for (const row of rows) {
		scope.threadIds.push(row.id);

		// Same precedence as openReason(): a thread that came back from a snooze
		// and then got a reply is a replied thread, and the older story stops
		// being the interesting one.
		const snoozed = row.snoozedUntil?.getTime() ?? null;
		const last = row.lastMessageAt?.getTime() ?? null;
		if (snoozed !== null && (last === null || last <= snoozed)) scope.returned++;
		else if (!row.lastOutboundAt) scope.unanswered++;
		// The third kind, and the one the design's breakdown omits: we answered
		// and they came back. Leaving it out would make the rows sum to less than
		// the total, which reads as an arithmetic bug rather than a category.
		else scope.replied++;

		if (row.waitingSince * 1000 <= weekAgo) scope.longWaiting++;
	}

	return scope;
}

/** How long a thread waits on a contact before it comes back to us anyway. */
export const AWAITING_NUDGE_DAYS = 7;

/**
 * Hand back every thread the contact has stopped answering.
 *
 * "Send + wait for reply" is only safe because of this. Without it, a thread
 * whose contact simply never writes back leaves the Open view for good — which
 * is the same outcome as forgetting about them, reached by a button that
 * promised the opposite. After a week the marker clears and the conversation is
 * ours again, still open, at the top of a queue sorted by longest waiting.
 *
 * Runs beside `wakeSnoozedThreads` on the same cron, which is the other half of
 * the same job: putting back what left the queue on a timer.
 */
export async function nudgeStaleAwaiting(now: Date = new Date()): Promise<{ nudged: number }> {
	const cutoff = new Date(now.getTime() - AWAITING_NUDGE_DAYS * 86_400_000);
	const due = and(
		eq(inboxThread.status, 'open'),
		isNotNull(inboxThread.awaitingReplySince),
		lte(inboxThread.awaitingReplySince, cutoff)
	);

	const rows = await db.select({ id: inboxThread.id }).from(inboxThread).where(due);
	if (rows.length === 0) return { nudged: 0 };

	// No undo snapshot: this is not a disposition anybody took, and leaving one
	// behind would let ⌘Z on an unrelated thread reach back into the cron's work.
	await db.update(inboxThread).set({ awaitingReplySince: null, updatedAt: now }).where(due);

	return { nudged: rows.length };
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
