import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * One Refund action over two handlers: the checked box refunds and cancels
 * (slot to the waitlist, member notified), the unchecked box refunds and leaves
 * the booking standing (#669). The money moves either way, so the form's
 * action is the only evidence of which handler a submit reaches.
 */

vi.mock('$lib/remote/reservations.remote', () => {
	const remoteForm = (name: string) => ({
		enhance: () => ({ method: 'POST', action: `?/${name}` }),
		fields: {
			id: {
				as: (type: string, value?: unknown) => ({ type, name: 'id', value }),
				issues: () => null
			},
			allIssues: () => null
		},
		result: undefined
	});
	return {
		refundAndCancelReservation: remoteForm('refundAndCancelReservation'),
		refundOnlyReservation: remoteForm('refundOnlyReservation')
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

const RefundReservationAction = (await import('./RefundReservationAction.svelte')).default;

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

const formAction = () =>
	(document.querySelector('[role="dialog"] form') as HTMLFormElement).getAttribute('action');

const alsoCancel = () => page.getByRole('checkbox', { name: /Also cancel this reservation/ });

describe('RefundReservationAction', () => {
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

	// Without this the refund names no reservation and the handler refunds
	// nothing — a submit that looks like it worked.
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
