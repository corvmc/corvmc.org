import { toast } from 'svelte-sonner';
import { undoThreadDisposition } from '$lib/remote/inbox.remote';
import { invalidateQueue } from './queue.svelte';

/**
 * Every disposition is reversible for ten seconds.
 *
 * Two ways in — the Undo button on the toast, and ⌘Z — pointed at one thing, so
 * they cannot disagree about which thread the last action was on. The server
 * holds the state to restore (`inbox_thread.undo_state`); this only remembers
 * *which* thread to ask about, and forgets it when the toast expires.
 *
 * One step deep on purpose. Undo here is a correction of the action you just
 * took, not a history: a second ⌘Z does nothing, and the command says so
 * rather than erroring.
 */

/** How long the toast — and therefore the undo — stays available. */
export const UNDO_MS = 10_000;

let pending = $state<{ threadId: string; label: string } | null>(null);

/** The thread ⌘Z would undo, or null. Read by the keyboard binding. */
export function undoable() {
	return pending;
}

async function run(threadId: string) {
	// Cleared first: the request is in flight and a second press must not fire a
	// second undo at a snapshot that has already been spent.
	if (pending?.threadId === threadId) pending = null;

	const result = await undoThreadDisposition(threadId);
	if (result.undone) {
		invalidateQueue();
		toast.success('Undone');
	}
	// A false result is the ordinary "nothing left to undo" — the snooze cron or
	// an inbound message may well have moved the thread on. Saying so would be
	// noise on a keystroke the user may not have meant.
}

/**
 * Announce a disposition and offer to take it back.
 *
 * Replaces the plain `successToast` on these forms: "Marked resolved" with no
 * way back is the same sentence with the useful half missing.
 */
export function dispositionToast(label: string, threadId: string) {
	pending = { threadId, label };

	toast.success(label, {
		duration: UNDO_MS,
		action: { label: 'Undo', onClick: () => void run(threadId) },
		onAutoClose: () => {
			if (pending?.threadId === threadId) pending = null;
		},
		onDismiss: () => {
			if (pending?.threadId === threadId) pending = null;
		}
	});
}

/** What ⌘Z is bound to. No-op when the toast has already expired. */
export function undoLast() {
	const target = pending;
	if (target) void run(target.threadId);
}
