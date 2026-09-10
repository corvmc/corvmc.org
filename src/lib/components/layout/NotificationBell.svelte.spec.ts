// The real stylesheet, because two of the defects below are classes that emit
// no CSS at all — a shape `pnpm check`, ESLint and the DOM are all blind to.
import '../../../routes/layout.css';
import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChromeNotification } from './chrome';

// The notifications arrive as props now (#569); what still needs a live server
// is the mark-read commands and the EventSource stream, so the remote module is
// mocked for those two and EventSource is stubbed below.
vi.mock('$lib/remote/notifications.remote', () => ({
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
		await render(NotificationBell, { notifications: [], unreadCount: 0 });

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
		const screen = await render(NotificationBell, { notifications: [], unreadCount: 0 });

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

/**
 * Rows come in four combinations — linked or not, read or not — and the two
 * branches render separate markup, so a class fixed in one can stay broken in
 * the other. These read computed colour off the built stylesheet rather than
 * matching class strings, which is the only way a dead class is visible.
 */
describe('NotificationBell rows', () => {
	const MIXED = [
		{ id: 'a', title: 'Linked, unread', href: '/member', readAt: null },
		{ id: 'b', title: 'Plain, unread', href: null, readAt: null },
		{ id: 'c', title: 'Linked, read', href: '/member', readAt: new Date() },
		{ id: 'd', title: 'Plain, read', href: null, readAt: new Date() }
	].map((n) => ({
		userId: 'u',
		type: 'reservation',
		body: null,
		data: null,
		createdAt: new Date(),
		...n
	}));

	async function openPanel() {
		await render(NotificationBell, {
			notifications: MIXED as ChromeNotification[],
			unreadCount: 2
		});
		await page.getByRole('button', { name: 'Notifications' }).click();
		return Array.from(document.querySelectorAll<HTMLElement>('.max-h-80 > div > :first-child'));
	}

	it('rules every row with the same colour, linked or not', async () => {
		const [linked, plain] = await openPanel();

		expect(getComputedStyle(linked).borderBottomColor).toBe(
			getComputedStyle(plain).borderBottomColor
		);
	});

	// The dot is the only thing marking a row unread. On a full `bg-primary` row
	// it is the same colour as what it sits on, so it disappears entirely.
	it('keeps the unread dot visible against the row it sits on', async () => {
		const [linkedUnread] = await openPanel();
		const dot = linkedUnread.querySelector<HTMLElement>('.rounded-full')!;

		expect(getComputedStyle(dot).backgroundColor).not.toBe(
			getComputedStyle(linkedUnread).backgroundColor
		);
	});

	// Companion to the two above rather than a regression: it stops the contrast
	// fix being taken further, to a tint so faint that unread stops reading.
	it('still marks an unread row apart from a read one', async () => {
		const rows = await openPanel();
		const [linkedUnread, plainUnread, linkedRead] = rows;

		for (const row of [linkedUnread, plainUnread]) {
			expect(getComputedStyle(row).backgroundColor).not.toBe(
				getComputedStyle(linkedRead).backgroundColor
			);
		}
	});

	// #897: colour was the *only* unread marker — a 10%-opacity tint and a 2px
	// dot with no text. In the accessibility tree 28 rows read identically.
	it('names an unread row as unread, without relying on colour', async () => {
		const rows = await openPanel();
		const [linkedUnread, , linkedRead] = rows;

		expect(linkedUnread.textContent).toContain('Unread');
		expect(linkedRead.textContent).not.toContain('Unread');

		const weight = (row: HTMLElement) => getComputedStyle(row.querySelector('p')!).fontWeight;
		expect(Number(weight(linkedUnread))).toBeGreaterThan(Number(weight(linkedRead)));
	});

	// The dot repeats what the text now says, so it must not be a second thing
	// for a screen reader to read out.
	it('leaves the unread dot out of the accessibility tree', async () => {
		const [linkedUnread] = await openPanel();
		const dot = linkedUnread.querySelector<HTMLElement>('.rounded-full')!;

		expect(dot.getAttribute('aria-hidden')).toBe('true');
	});
});
