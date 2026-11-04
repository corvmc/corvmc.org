import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';
import { formatDuration } from '#lib/utils/format.js';

// One file for the staff cancel and refund actions: they mock the same two
// modules, and each export below is the stub its own spec used before the merge.
// Prefix fidelity (`b:`, `n:`) is pinned in `ui/Form/FormField.svelte.spec.ts`.
vi.mock('#lib/remote/reservations.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const form = (action: string, names: string[]) => ({
		enhance: () => ({ method: 'POST', action: `?/${action}` }),
		fields: {
			...Object.fromEntries(names.map((name) => [name, field(name)])),
			allIssues: () => null
		},
		result: undefined
	});
	return {
		cancelReservation: form('cancelReservation', ['id', 'reason']),
		refundAndCancelReservation: form('refundAndCancelReservation', ['id']),
		refundOnlyReservation: form('refundOnlyReservation', ['id'])
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CancelReservationAction = (await import('./CancelReservationAction.svelte')).default;
const RefundReservationAction = (await import('./RefundReservationAction.svelte')).default;

const formAction = () =>
	(document.querySelector('[role="dialog"] form') as HTMLFormElement).getAttribute('action');

describe('CancelReservationAction', () => {
	// Two hours on a fixed instant. The summary formats in venue time, so only the
	// duration — a difference between two instants — is safe to assert on.
	const reservation = {
		id: 'res-1',
		startsAt: new Date('2026-03-14T19:00:00Z'),
		endsAt: new Date('2026-03-14T21:00:00Z'),
		status: 'confirmed',
		price: 30
	} as never;

	// The trigger is the container's only button; the dialog portals out of it.
	const open = async (props: Record<string, unknown> = {}) => {
		const { locator } = await render(CancelReservationAction, { reservation, ...props });
		await locator.getByRole('button').click();
		return page.getByRole('dialog');
	};
	const reason = () => page.getByRole('dialog').getByCss(':is([name="reason"], [name^="reason/"])');

	// The trigger is destructive and the modal is the only confirmation step, so
	// it has to name the reservation rather than ask about "this reservation" in
	// the abstract — the staff table shows several at once.
	it('names what is about to be cancelled', async () => {
		const dialog = await open();

		await expect.element(dialog).toBeVisible();
		await expect
			.element(dialog)
			.toMatchTextContent(
				formatDuration(new Date('2026-03-14T19:00:00Z'), new Date('2026-03-14T21:00:00Z'))
			);
	});

	it('offers no reason box by default', async () => {
		await expect.element(await open()).toBeVisible();

		await expect.element(reason()).not.toBeInTheDocument();
	});

	it('offers a reason box when asked for one', async () => {
		await open({ showReasonInput: true });

		await expect.element(reason()).toBeVisible();
	});
});

/**
 * One Refund action over two handlers: the checked box refunds and cancels
 * (slot to the waitlist, member notified), the unchecked box refunds and leaves
 * the booking standing (#669). The money moves either way, so the form's
 * action is the only evidence of which handler a submit reaches.
 */
describe('RefundReservationAction', () => {
	const reservation = {
		id: 'res-5',
		startsAt: new Date('2026-03-14T19:00:00Z'),
		endsAt: new Date('2026-03-14T21:00:00Z'),
		memberName: 'Jane Doe'
	} as never;

	const open = async (props: Record<string, unknown> = {}) => {
		const { locator } = await render(RefundReservationAction, { reservation, ...props });
		await locator.getByRole('button').click();
		const dialog = page.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		return dialog;
	};

	const alsoCancel = () => page.getByRole('dialog').getByRole('checkbox');
	const submit = () => page.getByRole('dialog').getByCss('button[type="submit"]');
	const refundOnlyNote = () => page.getByRole('dialog').getByTestId('refund-only-note');

	it('defaults to refunding and cancelling', async () => {
		await open();

		await expect.element(alsoCancel()).toBeChecked();
		expect(formAction()).toBe('?/refundAndCancelReservation');
		await expect.element(submit()).toBeVisible();
		expect(refundOnlyNote().query()).toBeNull();
	});

	it('refunds only, leaving the booking standing, once the box is cleared', async () => {
		await open();
		const cancellingLabel = submit().element().textContent;

		await alsoCancel().click();

		await expect.element(alsoCancel()).not.toBeChecked();
		await expect.poll(formAction).toBe('?/refundOnlyReservation');
		// The submit names the other operation now; which words it uses is copy.
		await expect.poll(() => submit().element().textContent).not.toBe(cancellingLabel);
		await expect.element(refundOnlyNote()).toBeVisible();
	});

	// A completed booking cannot be cancelled, so there is no choice to offer.
	it('offers only the refund when the booking cannot be cancelled', async () => {
		await open({ canCancel: false });

		await expect.element(alsoCancel()).not.toBeInTheDocument();
		expect(formAction()).toBe('?/refundOnlyReservation');
	});

	// The form swaps handler with the box; the id has to survive the swap, or the
	// refund names no reservation and looks like it worked.
	it('carries the reservation id into the form on both paths', async () => {
		await open();

		const hidden = () =>
			document.querySelectorAll<HTMLInputElement>(
				'[role="dialog"] input:is([name="id"], [name^="id/"])'
			);
		expect([...hidden()].map((i) => [i.type, i.value])).toEqual([['hidden', 'res-5']]);

		await alsoCancel().click();
		await expect.poll(formAction).toBe('?/refundOnlyReservation');

		expect([...hidden()].map((i) => [i.type, i.value])).toEqual([['hidden', 'res-5']]);
	});
});
