import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';
import { toast } from 'svelte-sonner';
import ActionHarness from './Action.test.svelte';
import '#lib/test/locators.js';

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
	rejectWith,
	setFields = () => {}
}: {
	result?: unknown;
	ok?: boolean;
	rejectWith?: unknown;
	setFields?: (input: unknown) => void;
} = {}) {
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
		fields: { value: { allIssues: () => null, set: setFields } },
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

/**
 * Locators by structure (#2189). The trigger is the only button inside the
 * render container — the modal portals out of it. A confirm dialog's footer
 * puts Dismiss first and the action last; a form's plain submit is the
 * `type=submit` without `data-add-another`.
 */
const modal = () => page.getByRole('dialog');
const dismissButton = () => modal().getByCss('.modal-action button').first();
const confirmButton = () => modal().getByCss('.modal-action button').last();
const submitButton = () => modal().getByCss('button[type="submit"]:not([data-add-another])');
const addAnotherButton = () => modal().getByCss('[data-add-another]');
const mount = async (props: Record<string, unknown>) => {
	const screen = await render(ActionHarness, props as never);
	return { ...screen, trigger: screen.locator.getByRole('button') };
};

// Fixture copy: these are props the spec passes in, not the app's wording.
const CONFIRM = 'This cannot be undone.';

describe('Action, callback mode', () => {
	it('runs on click with no dialog in the way', async () => {
		const run = vi.fn(async () => 'done');
		const { trigger } = await mount({ action: run, label: 'Retry' });

		await trigger.click();

		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(dialog()).toBeNull();
	});

	// The trigger is the only progress indicator a bare callback has, and it is
	// disabled while pending — which is also what stops a second run.
	it('disables the trigger while the callback is in flight', async () => {
		let release: () => void = () => {};
		const run = vi.fn(() => new Promise<void>((r) => (release = r)));
		const { trigger } = await mount({ action: run, label: 'Retry' });

		await trigger.click();

		await expect.element(trigger).toBeDisabled();
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
		const label = 'Retry';
		const successLabel = 'Retried';
		const { trigger } = await mount({
			action: async () => undefined,
			label,
			successLabel,
			flashDuration: 2000
		});

		await trigger.click();

		await expect.element(page.getByRole('button', { name: successLabel })).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: label }), { timeout: 5000 })
			.toBeVisible();
	});

	it('reports the callback result to onsuccess', async () => {
		const onsuccess = vi.fn();
		const { trigger } = await mount({
			action: async () => ({ id: 'x' }),
			label: 'Retry',
			onsuccess
		});

		await trigger.click();

		await vi.waitFor(() => expect(onsuccess).toHaveBeenCalledWith({ id: 'x' }));
	});

	it('does not run at all when disabled', async () => {
		const run = vi.fn(async () => undefined);
		const { trigger } = await mount({ action: run, label: 'Retry', disabled: true });

		await expect.element(trigger).toBeDisabled();
		expect(run).not.toHaveBeenCalled();
	});

	// In a table action cell the label would overflow a square button, so it
	// moves to the accessible name. Without that the control is unnamed.
	it('keeps a name when the label is hidden', async () => {
		const label = 'Cancel';
		await render(ActionHarness, { action: async () => undefined, label, iconOnly: true });

		const trigger = page.getByRole('button', { name: label });
		await expect.element(trigger).toBeVisible();
		expect((trigger.element() as HTMLElement).textContent?.trim()).toBe('');
	});
});

describe('Action, confirm mode', () => {
	it('asks before running', async () => {
		const run = vi.fn(async () => undefined);
		const { trigger } = await mount({ action: run, label: 'Delete', confirm: CONFIRM });

		await trigger.click();

		await expect.element(modal().getByText(CONFIRM)).toBeVisible();
		expect(run).not.toHaveBeenCalled();
	});

	it('runs once the confirmation is given', async () => {
		const run = vi.fn(async () => undefined);
		const { trigger } = await mount({ action: run, label: 'Delete', confirm: CONFIRM });

		await trigger.click();
		await confirmButton().click();

		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
	});

	it('leaves the action alone when dismissed', async () => {
		const run = vi.fn(async () => undefined);
		const { trigger } = await mount({ action: run, label: 'Delete', confirm: CONFIRM });

		await trigger.click();
		await dismissButton().click();

		await vi.waitFor(() => expect(dialog()).toBeNull());
		expect(run).not.toHaveBeenCalled();
	});
});

// #1030: callback mode set `status = 'error'`, which renders `errorLabel` on
// the *trigger* — and a confirmed action's trigger is behind the open dialog.
// Nothing else happened, so a refusal written for the member reached nobody.
describe('Action, callback failure', () => {
	const refusal = {
		status: 400,
		body: { message: 'This is the only card on your membership.' }
	};

	it('tells the member why a confirmed action was refused', async () => {
		vi.mocked(toast.error).mockClear();
		const { trigger } = await mount({
			action: vi.fn(async () => {
				throw refusal;
			}),
			label: 'Remove',
			confirm: CONFIRM
		});

		await trigger.click();
		await confirmButton().click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('This is the only card on your membership.')
		);
	});

	it('surfaces it through the error boundary the panels mount', async () => {
		vi.mocked(toast.error).mockClear();
		const { trigger } = await mount({
			boundary: true,
			action: vi.fn(async () => {
				throw refusal;
			}),
			label: 'Remove',
			confirm: CONFIRM
		});

		await trigger.click();
		await confirmButton().click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('This is the only card on your membership.')
		);
	});
});

describe('Action, form mode', () => {
	it('submits through the modal and closes it', async () => {
		const onsuccess = vi.fn();
		const { trigger } = await mount({
			action: fakeRemoteForm({ result: { bandId: 'band-1' } }),
			label: 'Save',
			modalTitle: 'Edit',
			fieldName: 'title',
			onsuccess
		});

		await trigger.click();
		await submitButton().click();

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
			const { trigger } = await mount({
				action: fakeRemoteForm({ result: outcome }),
				label: 'Book',
				modalTitle: 'Book the space',
				fieldName: 'slot',
				onsuccess
			});

			await trigger.click();
			await submitButton().click();

			// Wait for the submit to actually land — the success flash on the submit
			// button is the first thing that happens after it — or the assertions
			// below run before the modal has had a chance to close and pass either way.
			await expect.element(submitButton()).toHaveAttribute('data-status', 'success');
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
		const { trigger } = await mount({
			action: fakeRemoteForm({
				rejectWith: { status: 422, body: { message: 'Not ready to announce: there is no poster.' } }
			}),
			label: 'Publish',
			fieldName: 'id'
		});

		await trigger.click();
		await submitButton().click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('Not ready to announce: there is no poster.')
		);
	});

	it('surfaces a thrown failure even when the caller passes onfailure', async () => {
		vi.mocked(toast.error).mockClear();
		const onfailure = vi.fn();
		const { trigger } = await mount({
			action: fakeRemoteForm({ rejectWith: { status: 409, body: { message: '3 tickets sold' } } }),
			label: 'Unpublish',
			fieldName: 'id',
			onfailure
		});

		await trigger.click();
		await submitButton().click();

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
		const { trigger } = await mount({
			boundary: true,
			action: fakeRemoteForm({
				rejectWith: { status: 400, body: { message: 'You already have a subscription.' } }
			}),
			label: 'Subscribe',
			fieldName: 'id'
		});

		await trigger.click();
		await submitButton().click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('You already have a subscription.')
		);
	});

	// `submitLabel` is separate from `label` because the trigger names the thing
	// you are opening and the submit names the thing you are doing.
	it('gives the submit its own label', async () => {
		const label = 'New Band';
		const submitLabel = 'Create Band';
		const { trigger } = await mount({
			action: fakeRemoteForm(),
			label,
			submitLabel,
			fieldName: 'name'
		});

		await trigger.click();

		await expect.element(submitButton()).toMatchTextContent(submitLabel);
		await expect.element(submitButton()).not.toMatchTextContent(label);
	});

	it('renders no footer when the form supplies its own', async () => {
		const { trigger } = await mount({
			action: fakeRemoteForm(),
			label: 'Save',
			noFooter: true,
			fieldName: 'title'
		});

		await trigger.click();

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
describe('Action, save and add another', () => {
	// The run-of-records case: an arrival of twelve things is twelve submits, and
	// reopening the modal for each was the reason intake looked like the only way.
	it('keeps the modal open and hands over to onaddanother', async () => {
		const onsuccess = vi.fn();
		const onaddanother = vi.fn();
		const { trigger } = await mount({
			action: fakeRemoteForm({ result: { id: 'item-1' } }),
			label: 'Add Item',
			modalTitle: 'Add Item',
			fieldName: 'name',
			addAnotherLabel: 'Save and add another',
			onsuccess,
			onaddanother
		});

		await trigger.click();
		await addAnotherButton().click();

		await vi.waitFor(() => expect(onaddanother).toHaveBeenCalledWith({ id: 'item-1' }));
		expect(onsuccess).toHaveBeenCalledWith({ id: 'item-1' });
		expect(dialog()).not.toBeNull();
	});

	// Field-bound inputs read the instance's values, which outlive the dialog.
	it('clears the typed values when it closes, and only then', async () => {
		const setFields = vi.fn();
		const { trigger } = await mount({
			action: fakeRemoteForm({ result: { id: 'item-1' }, setFields }),
			label: 'Add Item',
			modalTitle: 'Add Item',
			fieldName: 'name',
			addAnotherLabel: 'Save and add another'
		});

		await trigger.click();
		await addAnotherButton().click();
		await vi.waitFor(() => expect(addAnotherButton()).toBeEnabled());
		expect(setFields).not.toHaveBeenCalled();

		await submitButton().click();
		await vi.waitFor(() => expect(dialog()).toBeNull());
		expect(setFields).toHaveBeenCalledWith({});
	});

	it('still closes on the plain submit', async () => {
		const onaddanother = vi.fn();
		const { trigger } = await mount({
			action: fakeRemoteForm({ result: { id: 'item-1' } }),
			label: 'Add Item',
			modalTitle: 'Add Item',
			fieldName: 'name',
			addAnotherLabel: 'Save and add another',
			onaddanother
		});

		await trigger.click();
		await submitButton().click();

		await vi.waitFor(() => expect(dialog()).toBeNull());
		expect(onaddanother).not.toHaveBeenCalled();
	});

	it('offers no second submit unless asked', async () => {
		const { trigger } = await mount({
			action: fakeRemoteForm(),
			label: 'Save',
			modalTitle: 'Edit',
			fieldName: 'title'
		});

		await trigger.click();
		await expect.element(page.getByRole('dialog')).toBeVisible();
		expect(addAnotherButton().query()).toBeNull();
	});
});

describe('Action, canSubmit', () => {
	const gated = (canSubmit?: boolean) => ({
		action: fakeRemoteForm(),
		label: 'Adjust',
		submitLabel: 'Save',
		fieldName: 'amount',
		...(canSubmit === undefined ? {} : { canSubmit })
	});

	it('disables the modal submit while it is false', async () => {
		const { trigger } = await mount(gated(false));

		await trigger.click();

		await expect.element(submitButton()).toBeDisabled();
	});

	it('leaves the trigger enabled so the form can still be opened', async () => {
		const { trigger } = await mount(gated(false));

		await expect.element(trigger).toBeEnabled();
	});

	it('enables the submit once the gate opens', async () => {
		const props = gated(false);
		const { rerender, trigger } = await mount(props);

		await trigger.click();
		await expect.element(submitButton()).toBeDisabled();

		await rerender({ ...props, canSubmit: true });

		await expect.element(submitButton()).toBeEnabled();
	});

	it('gates nothing when it is not given', async () => {
		const { trigger } = await mount(gated());

		await trigger.click();

		await expect.element(submitButton()).toBeEnabled();
	});

	// The original defect, pinned at the DOM: an unread prop reaches the trigger
	// as an attribute, which is silent — no error, no type failure, no CSS.
	it('does not leak onto the trigger as an HTML attribute', async () => {
		const { trigger } = await mount(gated(false));

		expect(trigger.element().getAttribute('cansubmit')).toBeNull();
	});
});

/**
 * Closing threw the whole form away with no step in between, so a mis-click on
 * the ✕ cost a member the booking they had just typed. #876.
 */
describe('Action, unsaved changes', () => {
	const closeButton = () => modal().getByCss('[data-dialog-close]');
	const note = () => modal().getByCss('input:is([name="notes"], [name^="notes/"])');
	const prompt = () => page.getByTestId('discard-prompt');

	it('closes an untouched dialog without asking', async () => {
		const { trigger } = await mount({
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await trigger.click();
		await expect.element(page.getByRole('dialog')).toBeVisible();
		await closeButton().click();

		await vi.waitFor(() => expect(dialog()).toBeNull());
	});

	it('asks before discarding a form that has been typed into', async () => {
		const { trigger } = await mount({
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await trigger.click();
		await note().fill('bring the amp');
		await closeButton().click();

		await expect.element(prompt()).toBeVisible();
		expect(dialog()).not.toBeNull();
	});

	it('keeps what was typed when the discard is declined', async () => {
		const { trigger } = await mount({
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await trigger.click();
		await note().fill('bring the amp');
		await closeButton().click();
		await prompt().getByRole('button').first().click();

		await expect.element(note()).toHaveValue('bring the amp');
	});

	it('closes on the second answer when the discard is confirmed', async () => {
		const { trigger } = await mount({
			action: fakeRemoteForm(),
			label: 'Book',
			formFieldName: 'notes'
		});

		await trigger.click();
		await note().fill('bring the amp');
		await closeButton().click();
		await prompt().getByRole('button').last().click();

		await vi.waitFor(() => expect(dialog()).toBeNull());
	});
});
