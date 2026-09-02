/**
 * The two things the queue says about a thread that the database does not
 * store: which of the five views it belongs to, and why it is sitting there.
 *
 * `inbox_thread.awaiting_reply_since` is orthogonal to `inbox_thread.status`,
 * so an awaiting thread is an *open* row in the database. It is not an open
 * *conversation* in the sense the queue means: the ball is with the contact.
 * Open and Awaiting reply are therefore separate views, and Open is exactly
 * what the staff nav badge counts — see `needsUsCondition` in thread-service.
 *
 * Everything here is derived on read and never stored, the same shape as
 * `displayStatus()` in the suggestion service.
 */

type StatusFields = {
	status: string;
	awaitingReplySince?: Date | string | null;
};

/** What the badge says. */
export function threadDisplayStatus(thread: StatusFields): string {
	return thread.status === 'open' && thread.awaitingReplySince ? 'awaiting_reply' : thread.status;
}

export type OpenReason = 'replied' | 'unanswered' | 'snooze_expired';

type ReasonFields = StatusFields & {
	snoozedUntil?: Date | string | null;
	lastOutboundAt?: Date | string | null;
	lastMessageAt?: Date | string | null;
};

const ms = (value: Date | string | null | undefined): number | null =>
	value == null ? null : new Date(value).getTime();

/**
 * Why an open thread is in the queue. Null for anything that is not open and
 * waiting on us — a snoozed, resolved or awaiting thread is not there to be
 * explained.
 *
 * Snooze first, and only while nothing has arrived since it elapsed: a thread
 * that came back on its own and *then* got a reply is a replied thread, and the
 * older story stops being the interesting one. `wakeSnoozedThreads` leaves the
 * date in place for exactly this read.
 */
export function openReason(thread: ReasonFields): OpenReason | null {
	if (thread.status !== 'open' || thread.awaitingReplySince) return null;

	const snoozed = ms(thread.snoozedUntil);
	if (snoozed !== null) {
		const last = ms(thread.lastMessageAt);
		if (last === null || last <= snoozed) return 'snooze_expired';
	}

	return thread.lastOutboundAt ? 'replied' : 'unanswered';
}

/**
 * The clock the queue sorts and ages by. Mirrors the `waitingSince` SQL
 * fragment in thread-service — the list is ordered by that expression, so the
 * chip beside each row has to be reading the same thing or the order looks
 * arbitrary.
 */
export function waitingSince(thread: ReasonFields & { createdAt: Date | string }): Date {
	return new Date(thread.awaitingReplySince ?? thread.lastMessageAt ?? thread.createdAt);
}

/** Whole days waited, floored. Zero reads as "today", not as "no wait". */
export function waitingDays(
	thread: ReasonFields & { createdAt: Date | string },
	now: Date = new Date()
): number {
	const elapsed = now.getTime() - waitingSince(thread).getTime();
	return Math.max(0, Math.floor(elapsed / 86_400_000));
}
