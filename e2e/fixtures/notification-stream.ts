import type { Page } from '@playwright/test';

/**
 * The bell's stream, held in the test's hand: a `message` makes the bell call
 * `refreshAll()`, which is when a notification lands under an open dialog
 * or a half-typed draft. Call before the first navigation.
 */
export async function fakeNotificationStream(page: Page) {
	await page.addInitScript(() => {
		const open: EventTarget[] = [];
		class FakeEventSource extends EventTarget {
			onerror: ((e: Event) => void) | null = null;
			constructor() {
				super();
				open.push(this);
			}
			close() {}
		}
		Object.assign(window, {
			EventSource: FakeEventSource,
			__notificationStreams: open,
			__notify: () => open.forEach((s) => s.dispatchEvent(new MessageEvent('message')))
		});
	});
}

/** Fires one notification, once the bell has connected. */
export async function notify(page: Page) {
	await page.waitForFunction(
		() =>
			(window as unknown as { __notificationStreams: unknown[] }).__notificationStreams.length > 0
	);
	await page.evaluate(() => (window as unknown as { __notify: () => void }).__notify());
}
