import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';
import { toast } from 'svelte-sonner';
import ActionHarness from './Action.test.svelte';

/**
 * `Action` is the engine behind all 56 `actions/*` components, so what it gets
 * wrong it gets wrong 56 times. These pin the three modes it switches between —
 * a bare callback, a confirm dialog, and a remote form — and the trigger states
 * every one of them shares.
 */

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}));

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
function fakeRemoteForm({
	result,
	ok = true,
	rejectWith
}: { result?: unknown; ok?: boolean; rejectWith?: unknown } = {}) {
	let callback: ((instance: { submit: () => Promise<boolean> }) => unknown) | null = null;
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/thing' };

	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			void callback?.({
				submit: async () => {
					if (rejectWith) throw rejectWith;
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
	//
	// The flash has to outlast a loaded runner. Nothing holds it open, so a
	// window short enough to close before the locator's first poll makes the
	// first assertion unsatisfiable rather than slow. Both halves are asserted:
	// the flash, then the revert waited for past the window's own length.
	it('flashes the success label, then goes back to the label', async () => {
		await render(ActionHarness, {
			action: async () => undefined,
			label: 'Retry',
			successLabel: 'Retried',
			flashDuration: 2000
		});

		await page.getByRole('button', { name: 'Retry' }).click();

		await expect.element(page.getByRole('button', { name: 'Retried' })).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: 'Retry' }), { timeout: 5000 })
			.toBeVisible();
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

	/**
	 * The whole app used to answer a failed action with the word "Error" and
	 * nothing else: `Action` passed `onfailure` on every dialog, and `Form` read
	 * that as "the caller owns the message" and stayed silent. A thrown error has
	 * no field to render in, so it is surfaced whether a handler exists or not.
	 */
	it('surfaces a thrown failure, with no onfailure handler', async () => {
		vi.mocked(toast.error).mockClear();
		await render(ActionHarness, {
			action: fakeRemoteForm({
				rejectWith: { status: 422, body: { message: 'Not ready to announce: there is no poster.' } }
			}),
			label: 'Publish',
			fieldName: 'id'
		});

		await page.getByRole('button', { name: 'Publish' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('Not ready to announce: there is no poster.')
		);
	});

	it('surfaces a thrown failure even when the caller passes onfailure', async () => {
		vi.mocked(toast.error).mockClear();
		const onfailure = vi.fn();
		await render(ActionHarness, {
			action: fakeRemoteForm({ rejectWith: { status: 409, body: { message: '3 tickets sold' } } }),
			label: 'Unpublish',
			fieldName: 'id',
			onfailure
		});

		await page.getByRole('button', { name: 'Unpublish' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();

		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('3 tickets sold'));
		// The handler still runs, and now receives the error rather than the issues.
		await vi.waitFor(() =>
			expect(onfailure).toHaveBeenCalledWith({ status: 409, body: { message: '3 tickets sold' } })
		);
	});

	// #1000 said a failed subscription showed the member nothing, and blamed
	// `Form.surfaceFailure` routing to an error boundary "that renders nothing".
	// Every panel layout mounts one, so this is the branch the app actually
	// takes — and the two tests above only ever exercised the other one.
	it('surfaces a thrown failure through the error boundary the panels mount', async () => {
		vi.mocked(toast.error).mockClear();
		await render(ActionHarness, {
			boundary: true,
			action: fakeRemoteForm({
				rejectWith: { status: 400, body: { message: 'You already have a subscription.' } }
			}),
			label: 'Subscribe',
			fieldName: 'id'
		});

		await page.getByRole('button', { name: 'Subscribe' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Subscribe' }).click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('You already have a subscription.')
		);
	});

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

/**
 * `canSubmit` gates the modal's submit, not the trigger: a form you cannot open
 * is a form you can never fill in to the point where it becomes submittable.
 * It arrived as an undeclared prop at thirteen call sites, which meant it fell
 * into `...rest` and landed on the trigger as a stray `cansubmit` attribute.
 */
describe('Action, canSubmit', () => {
	const gated = (canSubmit?: boolean) => ({
		action: fakeRemoteForm(),
		label: 'Adjust',
		submitLabel: 'Save',
		fieldName: 'amount',
		...(canSubmit === undefined ? {} : { canSubmit })
	});

	const submit = () => page.getByRole('dialog').getByRole('button', { name: 'Save' });

	it('disables the modal submit while it is false', async () => {
		await render(ActionHarness, gated(false));

		await page.getByRole('button', { name: 'Adjust' }).click();

		await expect.element(submit()).toBeDisabled();
	});

	it('leaves the trigger enabled so the form can still be opened', async () => {
		await render(ActionHarness, gated(false));

		await expect.element(page.getByRole('button', { name: 'Adjust' })).toBeEnabled();
	});

	it('enables the submit once the gate opens', async () => {
		const props = gated(false);
		const { rerender } = await render(ActionHarness, props);

		await page.getByRole('button', { name: 'Adjust' }).click();
		await expect.element(submit()).toBeDisabled();

		await rerender({ ...props, canSubmit: true });

		await expect.element(submit()).toBeEnabled();
	});

	it('gates nothing when it is not given', async () => {
		await render(ActionHarness, gated());

		await page.getByRole('button', { name: 'Adjust' }).click();

		await expect.element(submit()).toBeEnabled();
	});

	// The original defect, pinned at the DOM: an unread prop reaches the trigger
	// as an attribute, which is silent — no error, no type failure, no CSS.
	it('does not leak onto the trigger as an HTML attribute', async () => {
		await render(ActionHarness, gated(false));

		const trigger = page.getByRole('button', { name: 'Adjust' }).element();
		expect(trigger.getAttribute('cansubmit')).toBeNull();
	});
});

/**
 * Closing threw the whole form away with no step in between, so a mis-click on
 * the ✕ cost a member the booking they had just typed. #876.
 */
describe('Action, unsaved changes', () => {
	const closeButton = () => page.getByRole('button', { name: 'Close' });

	it('closes an untouched dialog without asking', async () => {
		await render(ActionHarness, {
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await page.getByRole('button', { name: 'Book' }).click();
		await expect.element(page.getByRole('dialog')).toBeVisible();
		await closeButton().click();

		await vi.waitFor(() => expect(dialog()).toBeNull());
	});

	it('asks before discarding a form that has been typed into', async () => {
		await render(ActionHarness, {
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await page.getByRole('button', { name: 'Book' }).click();
		await page.getByRole('textbox', { name: 'Note' }).fill('bring the amp');
		await closeButton().click();

		await expect.element(page.getByText('You have unsaved changes')).toBeVisible();
		expect(dialog()).not.toBeNull();
	});

	it('keeps what was typed when the discard is declined', async () => {
		await render(ActionHarness, {
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await page.getByRole('button', { name: 'Book' }).click();
		await page.getByRole('textbox', { name: 'Note' }).fill('bring the amp');
		await closeButton().click();
		await page.getByRole('button', { name: 'Keep editing' }).click();

		await expect.element(page.getByRole('textbox', { name: 'Note' })).toHaveValue('bring the amp');
	});

	it('closes on the second answer when the discard is confirmed', async () => {
		await render(ActionHarness, {
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await page.getByRole('button', { name: 'Book' }).click();
		await page.getByRole('textbox', { name: 'Note' }).fill('bring the amp');
		await closeButton().click();
		await page.getByRole('button', { name: 'Discard' }).click();

		await vi.waitFor(() => expect(dialog()).toBeNull());
	});
});
