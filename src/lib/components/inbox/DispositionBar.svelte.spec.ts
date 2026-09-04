import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

// The bar writes through `disposeThread` and toasts through `undo.svelte`,
// which needs neither a server nor a mounted <Toaster> to prove which keys the
// window listeners answer to.
const disposeThread = vi.fn(() => Promise.resolve({ ok: true }));

vi.mock('$lib/remote/inbox.remote', () => ({
	disposeThread: (...args: unknown[]) => disposeThread(...(args as [])),
	undoThreadDisposition: vi.fn(() => Promise.resolve({ undone: false }))
}));

vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn() }
}));

// Dynamic, at module scope: it resolves after the `vi.mock` calls and pays the
// cold transform once during file evaluation rather than inside a test.
const DispositionBar = (await import('./DispositionBar.svelte')).default;

/** The listeners are on `window`, so the event has to bubble there. */
function press(key: string, modifier = false) {
	document.body.dispatchEvent(
		new KeyboardEvent('keydown', { key, metaKey: modifier, bubbles: true, cancelable: true })
	);
	// One macrotask: `dispose()` is called synchronously by the handler, but a
	// negative assertion should not pass merely by running first.
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DispositionBar', () => {
	beforeEach(() => {
		disposeThread.mockClear();
	});

	// The reported bug: these were bare letters on the window, so `E` resolved
	// the thread instead of being typed — anywhere focus was not a form field.
	it('ignores the disposition letter without the modifier', async () => {
		await render(DispositionBar, { threadId: 'thread-1', status: 'open' });

		await press('e');

		expect(disposeThread).not.toHaveBeenCalled();
	});

	it('resolves on the chorded shortcut', async () => {
		await render(DispositionBar, { threadId: 'thread-1', status: 'open' });

		await press('e', true);

		expect(disposeThread).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: 'thread-1', action: 'resolve' })
		);
	});

	// Reply is the surface's, not the bar's: a page whose composer is already on
	// screen passes no `onreply`, and then there is no button and no shortcut.
	it('offers Reply only when the surface handles it', async () => {
		await render(DispositionBar, { threadId: 'thread-1', status: 'open' });

		await expect.element(page.getByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
	});

	// The hint is only useful to someone already reaching for the modifier, which
	// is why it replaces the icon rather than sitting permanently beside it.
	it('shows the keys only while the modifier is held', async () => {
		await render(DispositionBar, { threadId: 'thread-1', status: 'open' });
		const keys = () => [...document.querySelectorAll('kbd')].map((k) => k.textContent);

		expect(keys()).toEqual([]);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }));
		await vi.waitFor(() => expect(keys()).toEqual(['S', 'E']));

		document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', bubbles: true }));
		await vi.waitFor(() => expect(keys()).toEqual([]));
	});

	// Snooze drew an `S` for a key that was never bound to anything. Opening the
	// menu is what the letter has to do.
	//
	// The assertion is on the trigger's `aria-expanded`, not on a date inside the
	// menu, and that is deliberate rather than a weakening. This asserted
	// `getByText('Tomorrow')` until it started failing on CI and only on CI — four
	// runs across three branches, never once locally, and not rescued by a five
	// second budget. Every one of those failures dumped a trigger reading
	// `data-state="open" aria-expanded="true" aria-controls="bits-c10"` with no
	// `bits-c10` anywhere in `<body>`: the shortcut did its whole job and
	// `DropdownMenu.Portal` did not paint. What that spells is a bits-ui portal
	// that does not mount on a headless Linux runner — third-party behaviour this
	// component neither owns nor can fix, and the same shape as the stranded-portal
	// bug #497 patched Svelte for.
	//
	// So the unit test asserts what DispositionBar actually controls: the letter
	// puts the menu in the open state. That the open menu then contains the dates
	// is SnoozeMenu's contract, and `e2e/inbox-awaiting-reply.e2e.ts` still clicks
	// through to "When they reply" in a real browser to prove it.
	it('opens the snooze menu on its shortcut', async () => {
		await render(DispositionBar, { threadId: 'thread-1', status: 'open' });

		await press('s', true);

		await expect
			.element(page.getByRole('button', { name: /Snooze/ }))
			.toHaveAttribute('aria-expanded', 'true');
	});
});
