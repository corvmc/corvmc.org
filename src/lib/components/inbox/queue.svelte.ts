/**
 * A nudge from a disposition to whatever is currently showing the queue.
 *
 * `getInboxThreads` is keyed by the list's filters, so a mutation cannot name
 * the instance the list is holding — the counts and the thread refresh by name
 * from the command, but the list itself cannot. The alternative is
 * `refreshAll()`, which refetches every query on the page to repaint one pane.
 *
 * So the list subscribes to a version number and refreshes itself, which is the
 * only place the current filters are known. One integer, bumped after every
 * write that could change who is in the queue.
 */

let version = $state(0);

/** Read inside an effect to re-run it after the next disposition. */
export function queueVersion(): number {
	return version;
}

/** Something moved a thread between views. */
export function invalidateQueue(): void {
	version++;
}
