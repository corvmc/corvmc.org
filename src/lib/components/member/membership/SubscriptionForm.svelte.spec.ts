import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';
import { toast } from 'svelte-sonner';
import Harness from './SubscriptionForm.test.svelte';

/**
 * #1000: pressing Become a Sustaining Member and getting a 500 changed nothing
 * on screen. The page mounts an ErrorToastBoundary, and the two existing
 * thrown-failure specs render none — so the branch the app takes had no cover.
 */

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}));

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

/** Faithful in the one respect that matters: the attachment intercepts submit. */
function rejectingForm(rejectWith: unknown) {
	let callback: ((i: { submit: () => Promise<boolean> }) => unknown) | null = null;
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/subscribe' };

	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (e: SubmitEvent) => {
			e.preventDefault();
			void callback?.({
				submit: async () => {
					throw rejectWith;
				}
			});
		};
		form.addEventListener('submit', onsubmit);
		return () => form.removeEventListener('submit', onsubmit);
	};

	Object.defineProperties(instance, {
		fields: { value: { allIssues: () => null } },
		result: { value: undefined, writable: true },
		enhance: {
			value: (cb: (i: { submit: () => Promise<boolean> }) => unknown) => {
				callback = cb;
				return instance;
			}
		}
	});
	return instance as never;
}

describe('SubscriptionForm failure', () => {
	it('tells the member when the subscription could not be created', async () => {
		vi.mocked(toast.error).mockClear();
		await render(Harness, {
			remote: rejectingForm({ status: 500, body: { message: 'Internal Error' } })
		});

		await page.getByRole('button', { name: 'Become a Sustaining Member' }).click();

		// The message, not just that something fired: "Internal Error" is poor copy
		// but it is the server's, and the member seeing it is the difference
		// between a button that failed and a button that did nothing.
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Internal Error'));
	});
});
