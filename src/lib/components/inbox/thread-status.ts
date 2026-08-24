/**
 * "Awaiting reply" is a marker on an open thread, not a status of its own —
 * `inbox_thread.awaiting_reply_since` is orthogonal to `inbox_thread.status`,
 * so an awaiting thread stays in the Open queue with everything else.
 *
 * The badge still has to say which of the two it is, so the list and the detail
 * page fold the pair into one display value here rather than each deciding for
 * itself. Same shape as `displayStatus()` in the suggestion service: derived on
 * read, never stored.
 */
export function threadDisplayStatus(thread: {
	status: string;
	awaitingReplySince?: Date | string | null;
}): string {
	return thread.status === 'open' && thread.awaitingReplySince ? 'awaiting_reply' : thread.status;
}
