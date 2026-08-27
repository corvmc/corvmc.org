import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Regression test for JAVASCRIPT-SVELTEKIT-2S.
 *
 * `NotificationBell` opens with `let data = $derived(await getNotifications())`.
 * Under `experimental.async`, every declaration *after* that await is gated on
 * it: the compiler emits them as bare `var`s assigned inside the second entry of
 * a `$.run([...])` pair, which only runs once the promise settles. The window
 * listener is not gated — `$.event('click', $.window, handleClickOutside)` is
 * attached synchronously, during setup.
 *
 * So for the length of one `getNotifications()` round trip the handler is live
 * while the state it reads is still `undefined`. `destroyed` reads `undefined`,
 * which is falsy, so its guard waves the click through; `open` reads `undefined`
 * and `$.get(undefined)` dereferences `.f` on it — the reported
 * `TypeError: undefined is not an object (evaluating 'e.f')`.
 *
 * The sibling spec cannot catch this: its mock resolves immediately, so the
 * window never exists there. This file keeps the query pending on purpose.
 */

/** Resolved by the test, not by the mock — the gap is the whole subject here. */
let settle: (v: { notifications: never[]; unreadCount: number }) => void = () => {};
let pending: Promise<{ notifications: never[]; unreadCount: number }>;

vi.mock('$lib/remote/notifications.remote', () => ({
	getNotifications: () => pending,
	markNotificationRead: vi.fn(),
	markAllNotificationsRead: vi.fn()
}));

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

class FakeEventSource {
	onerror: ((this: EventSource, ev: Event) => void) | null = null;
	addEventListener() {}
	close() {}
}

// Dynamic so it resolves after the `vi.mock` calls, at module scope so the cold
// Vite transform is paid during file evaluation rather than inside a test.
const NotificationBell = (await import('./NotificationBell.svelte')).default;

describe('NotificationBell, while its notifications query is still in flight', () => {
	beforeEach(() => {
		vi.stubGlobal('EventSource', FakeEventSource);
		pending = new Promise((resolve) => {
			settle = resolve;
		});
	});

	afterEach(() => {
		settle({ notifications: [], unreadCount: 0 });
	});

	it('survives a document click before the query resolves (JAVASCRIPT-SVELTEKIT-2S)', async () => {
		const uncaught: unknown[] = [];
		const onError = (e: ErrorEvent) => {
			uncaught.push(e.error ?? e.message);
			e.preventDefault();
		};
		window.addEventListener('error', onError);

		try {
			// Deliberately not awaited: awaiting would settle the component and close
			// the very window this test is about. `mount` runs synchronously inside,
			// so the click listener is already attached by the time render() returns.
			const mounted = render(NotificationBell);

			// The click the user actually made — a link, mid-navigation, on a slow
			// mobile connection, before the bell's own query had come back.
			document.body.click();

			settle({ notifications: [], unreadCount: 0 });
			await mounted;
			await new Promise((r) => setTimeout(r, 0));
		} finally {
			window.removeEventListener('error', onError);
		}

		expect(uncaught).toEqual([]);
	});
});
