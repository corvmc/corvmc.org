import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';
import ActionHarness from './Action.test.svelte';

/**
 * `Action` is the engine behind all 56 `actions/*` components, so what it gets
 * wrong it gets wrong 56 times. These pin the three modes it switches between —
 * a bare callback, a confirm dialog, and a remote form — and the trigger states
 * every one of them shares.
 */

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

/**
 * A RemoteForm faithful in the one respect that matters here: SvelteKit's
 * instance carries only `method`, `action` and an attachment as enumerable
 * properties, so those are all `<Form>`'s spread puts on the `<form>`. The
 * attachment is what intercepts the submit; without it the form navigates.
 */
function fakeRemoteForm({ result, ok = true }: { result?: unknown; ok?: boolean } = {}) {
	let callback: ((instance: { submit: () => Promise<boolean> }) => unknown) | null = null;
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/thing' };

	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			void callback?.({
				submit: async () => {
					instance.result = result;
					return ok;
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
			value: (cb: (instance: { submit: () => Promise<boolean> }) => unknown) => {
				callback = cb;
				return instance;
			}
		}
	});

	return instance as never;
}

const dialog = () => document.querySelector('[role="dialog"]');

describe('Action, callback mode', () => {
	it('runs on click with no dialog in the way', async () => {
		const run = vi.fn(async () => 'done');
		await render(ActionHarness, { action: run, label: 'Retry' });

		await page.getByRole('button', { name: 'Retry' }).click();

		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(dialog()).toBeNull();
	});

	// The trigger is the only progress indicator a bare callback has, and it is
	// disabled while pending — which is also what stops a second run.
	it('disables the trigger while the callback is in flight', async () => {
		let release: () => void = () => {};
		const run = vi.fn(() => new Promise<void>((r) => (release = r)));
		await render(ActionHarness, { action: run, label: 'Retry' });

		await page.getByRole('button', { name: 'Retry' }).click();

		await expect.element(page.getByRole('button', { name: 'Retry' })).toBeDisabled();
		release();
	});

	// `successLabel` flashes in place of the label so a click that changed
	// something server-side is acknowledged without a page change.
	it('flashes the success label, then goes back to the label', async () => {
		await render(ActionHarness, {
			action: async () => undefined,
			label: 'Retry',
			successLabel: 'Retried',
			flashDuration: 50
		});

		await page.getByRole('button', { name: 'Retry' }).click();

		await expect.element(page.getByRole('button', { name: 'Retried' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Retry' })).toBeVisible();
	});

	it('reports the callback result to onsuccess', async () => {
		const onsuccess = vi.fn();
		await render(ActionHarness, { action: async () => ({ id: 'x' }), label: 'Retry', onsuccess });

		await page.getByRole('button', { name: 'Retry' }).click();

		await vi.waitFor(() => expect(onsuccess).toHaveBeenCalledWith({ id: 'x' }));
	});

	it('does not run at all when disabled', async () => {
		const run = vi.fn(async () => undefined);
		await render(ActionHarness, { action: run, label: 'Retry', disabled: true });

		await expect.element(page.getByRole('button', { name: 'Retry' })).toBeDisabled();
		expect(run).not.toHaveBeenCalled();
	});

	// In a table action cell the label would overflow a square button, so it
	// moves to the accessible name. Without that the control is unnamed.
	it('keeps a name when the label is hidden', async () => {
		await render(ActionHarness, { action: async () => undefined, label: 'Cancel', iconOnly: true });

		const trigger = page.getByRole('button', { name: 'Cancel' });
		await expect.element(trigger).toBeVisible();
		expect((trigger.element() as HTMLElement).textContent?.trim()).toBe('');
	});
});

describe('Action, confirm mode', () => {
	it('asks before running', async () => {
		const run = vi.fn(async () => undefined);
		await render(ActionHarness, {
			action: run,
			label: 'Delete',
			confirm: 'This cannot be undone.'
		});

		await page.getByRole('button', { name: 'Delete' }).click();

		await expect.element(page.getByText('This cannot be undone.')).toBeVisible();
		expect(run).not.toHaveBeenCalled();
	});

	it('runs once the confirmation is given', async () => {
		const run = vi.fn(async () => undefined);
		await render(ActionHarness, {
			action: run,
			label: 'Delete',
			confirm: 'This cannot be undone.'
		});

		await page.getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
	});

	it('leaves the action alone when dismissed', async () => {
		const run = vi.fn(async () => undefined);
		await render(ActionHarness, {
			action: run,
			label: 'Delete',
			confirm: 'This cannot be undone.'
		});

		await page.getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Dismiss' }).click();

		await vi.waitFor(() => expect(dialog()).toBeNull());
		expect(run).not.toHaveBeenCalled();
	});
});

describe('Action, form mode', () => {
	it('submits through the modal and closes it', async () => {
		const onsuccess = vi.fn();
		await render(ActionHarness, {
			action: fakeRemoteForm({ result: { bandId: 'band-1' } }),
			label: 'Save',
			modalTitle: 'Edit',
			fieldName: 'title',
			onsuccess
		});

		await page.getByRole('button', { name: 'Save' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

		await vi.waitFor(() => expect(onsuccess).toHaveBeenCalledWith({ bandId: 'band-1' }));
		await vi.waitFor(() => expect(dialog()).toBeNull());
	});

	/**
	 * The recoverable-outcome branch. A wizard can report that the slot it was
	 * holding went to someone else between selection and submit; closing the
	 * modal on that would throw away everything the user had entered and leave
	 * the failure looking like a success.
	 */
	for (const outcome of [{ conflict: true }, { validationError: 'Out of window' }]) {
		const [key] = Object.keys(outcome);
		it(`keeps the modal open on a ${key} result`, async () => {
			const onsuccess = vi.fn();
			await render(ActionHarness, {
				action: fakeRemoteForm({ result: outcome }),
				label: 'Book',
				modalTitle: 'Book the space',
				fieldName: 'slot',
				onsuccess
			});

			await page.getByRole('button', { name: 'Book' }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'Book' }).click();

			// Wait for the submit to actually land — the success flash on the submit
			// button is the first thing that happens after it — or the assertions
			// below run before the modal has had a chance to close and pass either way.
			await expect.element(page.getByRole('button', { name: 'Saved' })).toBeVisible();
			expect(dialog()).not.toBeNull();
			expect(onsuccess).not.toHaveBeenCalled();
		});
	}

	// `submitLabel` is separate from `label` because the trigger names the thing
	// you are opening and the submit names the thing you are doing.
	it('gives the submit its own label', async () => {
		await render(ActionHarness, {
			action: fakeRemoteForm(),
			label: 'New Band',
			submitLabel: 'Create Band',
			fieldName: 'name'
		});

		await page.getByRole('button', { name: 'New Band' }).click();

		await expect.element(page.getByRole('button', { name: 'Create Band' })).toBeVisible();
	});

	it('renders no footer when the form supplies its own', async () => {
		await render(ActionHarness, {
			action: fakeRemoteForm(),
			label: 'Save',
			noFooter: true,
			fieldName: 'title'
		});

		await page.getByRole('button', { name: 'Save' }).click();

		await expect.element(page.getByRole('dialog')).toBeVisible();
		expect(document.querySelector('[role="dialog"] button[type="submit"]')).toBeNull();
	});
});
