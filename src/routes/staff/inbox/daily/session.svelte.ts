import type { DailyScope } from '$lib/server/inbox/thread-service';

/**
 * One Daily session: the order, where you are in it, and what you did.
 *
 * Client state, and deliberately no table. A session is a way of working
 * through threads, not a record of anything — every disposition it applies is
 * already persisted, undoable and visible in the queue the moment it lands. The
 * only thing that would survive a reload is the *order*, and re-deriving that
 * from a fresh scope is both cheaper and more correct: two threads that arrived
 * while you were in the session belong in the next one, not this one.
 *
 * What does persist is the day-stamp, so the header can say "Daily done"
 * rather than offering to start the same session again ten minutes later.
 */

export type Disposition = 'resolve' | 'snooze' | 'wait' | 'reopen';

const DONE_KEY = 'inbox:daily-done';

/** `YYYY-MM-DD` in local time — the session's day, not UTC's. */
function today(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${month}-${day}`;
}

let queue = $state<string[]>([]);
let cursor = $state(0);
let handled = $state<Record<Disposition | 'skip', number>>({
	resolve: 0,
	snooze: 0,
	wait: 0,
	reopen: 0,
	skip: 0
});
let skipped = $state<string[]>([]);
let started = $state(false);

export const session = {
	get started() {
		return started;
	},
	get total() {
		return queue.length;
	},
	/** 1-based, for "3 of 7". Clamped so the summary does not read "8 of 7". */
	get position() {
		return Math.min(cursor + 1, queue.length);
	},
	get currentId(): string | null {
		return queue[cursor] ?? null;
	},
	get finished() {
		return started && cursor >= queue.length;
	},
	get counts() {
		return handled;
	},
	get skipped() {
		return skipped;
	},

	start(scope: DailyScope) {
		queue = [...scope.threadIds];
		cursor = 0;
		handled = { resolve: 0, snooze: 0, wait: 0, reopen: 0, skip: 0 };
		skipped = [];
		started = true;
	},

	/** A thread left the queue. Move on. */
	dispose(action: Disposition) {
		handled[action]++;
		cursor++;
	},

	/**
	 * Skip is explicitly not a disposition: the thread stays exactly as it was
	 * and goes to the end of *this session*, not the end of the queue. Nothing
	 * is written, which is why it needs no undo.
	 */
	skip() {
		const id = queue[cursor];
		if (!id) return;
		// Only once. A thread you skip twice is one you have decided about, and
		// cycling it forever is not a decision the session should make for you.
		if (skipped.includes(id)) {
			cursor++;
			return;
		}
		skipped = [...skipped, id];
		handled.skip++;
		queue = [...queue.slice(0, cursor), ...queue.slice(cursor + 1), id];
	},

	end() {
		started = false;
		queue = [];
		cursor = 0;
	}
};

/** Has a session already been finished today? */
export function doneToday(): boolean {
	try {
		return localStorage.getItem(DONE_KEY) === today();
	} catch {
		// A browser refusing storage just means Daily is always on offer, which is
		// the safe direction to fail.
		return false;
	}
}

export function markDoneToday(): void {
	try {
		localStorage.setItem(DONE_KEY, today());
	} catch {
		// Same.
	}
}
