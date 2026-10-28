import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// One file for the staff cancel and refund actions: they mock the same two
// modules, and each export below is the stub its own spec used before the merge.
// Prefix fidelity (`b:`, `n:`) is pinned in `ui/Form/FormField.svelte.spec.ts`.
vi.mock('$lib/remote/reservations.remote', () => {
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

	const open = async () => {
		await page.getByRole('button', { name: 'Cancel' }).click();
		return page.getByRole('dialog');
	};

	// The trigger is destructive and the modal is the only confirmation step, so
	// it has to name the reservation rather than ask about "this reservation" in
	// the abstract — the staff table shows several at once.
	it('names what is about to be cancelled', async () => {
		await render(CancelReservationAction, { reservation });

		await expect.element(await open()).toBeVisible();
		await expect.element(page.getByText('2 hours', { exact: false })).toBeVisible();
	});

	it('offers no reason box by default', async () => {
		await render(CancelReservationAction, { reservation });
		await expect.element(await open()).toBeVisible();

		await expect.element(page.getByPlaceholder('Reason (optional)')).not.toBeInTheDocument();
	});

	it('offers a reason box when asked for one', async () => {
		await render(CancelReservationAction, { reservation, showReasonInput: true });
		await open();

		await expect.element(page.getByPlaceholder('Reason (optional)')).toBeVisible();
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
		await render(RefundReservationAction, { reservation, ...props });
		await page.getByRole('button', { name: 'Refund', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		return dialog;
	};

	const alsoCancel = () => page.getByRole('checkbox', { name: /Also cancel this reservation/ });

	it('defaults to refunding and cancelling', async () => {
		const dialog = await open();

		await expect.element(alsoCancel()).toBeChecked();
		expect(formAction()).toBe('?/refundAndCancelReservation');
		await expect.element(dialog.getByRole('button', { name: 'Refund and cancel' })).toBeVisible();
	});

	it('refunds only, leaving the booking standing, once the box is cleared', async () => {
		const dialog = await open();

		await alsoCancel().click();

		await expect.element(alsoCancel()).not.toBeChecked();
		await expect.poll(formAction).toBe('?/refundOnlyReservation');
		await expect.element(dialog.getByRole('button', { name: 'Refund', exact: true })).toBeVisible();
		await expect
			.element(page.getByText('the booking is not cancelled', { exact: false }))
			.toBeVisible();
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
			document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[name="id"]');
		expect([...hidden()].map((i) => [i.type, i.value])).toEqual([['hidden', 'res-5']]);

		await alsoCancel().click();
		await expect.poll(formAction).toBe('?/refundOnlyReservation');

		expect([...hidden()].map((i) => [i.type, i.value])).toEqual([['hidden', 'res-5']]);
	});
});
