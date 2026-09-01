import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

// NotificationBell awaits `getNotifications()` and opens an EventSource stream —
// both need a live server. Mocking the remote module and stubbing EventSource
// lets it render fully isolated (same pattern as AccountDropdown.svelte.spec.ts).
vi.mock('$lib/remote/notifications.remote', () => ({
	getNotifications: () => Promise.resolve({ notifications: [], unreadCount: 0 }),
	markNotificationRead: vi.fn(),
	markAllNotificationsRead: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn()
}));

class FakeEventSource {
	onerror: ((this: EventSource, ev: Event) => void) | null = null;
	addEventListener() {}
	close() {}
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const NotificationBell = (await import('./NotificationBell.svelte')).default;

// The dropdown is the wrapper's only other direct child. `.notification-bell-wrapper`
// is load-bearing markup — the click-outside handler keys off it — so this asks
// whether the panel is open without pinning any of the copy inside it.
const dropdown = () => document.querySelector('.notification-bell-wrapper > div');

describe('NotificationBell', () => {
	beforeEach(() => {
		vi.stubGlobal('EventSource', FakeEventSource);
	});

	it('opens on click and closes when clicking outside', async () => {
		await render(NotificationBell);

		const trigger = page.getByRole('button', { name: 'Notifications' });
		await expect.element(trigger).toBeVisible();

		await trigger.click();
		expect(dropdown()).not.toBeNull();

		// Click outside the bell wrapper — the dropdown must close.
		document.body.click();
		await vi.waitFor(() => expect(dropdown()).toBeNull());
	});

	// Regression test for JAVASCRIPT-SVELTEKIT-Q / JAVASCRIPT-SVELTEKIT-1A: the
	// click-outside handler can be invoked by a click that unmounts the component
	// (e.g. a navigation click) after its reactive state is torn down; touching
	// `open` then throws. Simulate by unmounting in a capture-phase listener so
	// the same click reaches the window handler after teardown.
	it('survives a click that unmounts the component mid-dispatch (JAVASCRIPT-SVELTEKIT-Q/1A)', async () => {
		const screen = await render(NotificationBell);

		const trigger = page.getByRole('button', { name: 'Notifications' });
		await trigger.click();
		expect(dropdown()).not.toBeNull();

		const uncaught: unknown[] = [];
		const onError = (e: ErrorEvent) => {
			uncaught.push(e.error ?? e.message);
			e.preventDefault();
		};
		window.addEventListener('error', onError);
		try {
			document.body.addEventListener('click', () => screen.unmount(), {
				once: true,
				capture: true
			});
			document.body.click();
			// Flush the microtask queue so any asynchronously surfaced error lands.
			await new Promise((r) => setTimeout(r, 0));
		} finally {
			window.removeEventListener('error', onError);
		}

		expect(uncaught).toEqual([]);
	});
});
