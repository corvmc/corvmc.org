import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The other half of the refund pair. This one releases the slot to the waitlist
 * and notifies the member; its neighbour does neither. Both take the same
 * money, so the refund landing proves nothing about which of the two ran.
 *
 * `refundOnlyReservation` is mocked here too, so a component that reaches for
 * its sibling's remote fails on the handler rather than passing quietly.
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

const RefundAndCancelReservationAction = (await import('./RefundAndCancelReservationAction.svelte'))
	.default;

const reservation = {
	id: 'res-5',
	startsAt: new Date('2026-03-14T19:00:00Z'),
	endsAt: new Date('2026-03-14T21:00:00Z'),
	memberName: 'Jane Doe'
} as never;

const open = async () => {
	await render(RefundAndCancelReservationAction, { reservation });
	await page.getByRole('button', { name: 'Refund and cancel' }).click();
	return page.getByRole('dialog');
};

describe('RefundAndCancelReservationAction', () => {
	it('refunds through the handler that also releases the slot', async () => {
		await expect.element(await open()).toBeVisible();

		const form = document.querySelector('[role="dialog"] form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/refundAndCancelReservation');
	});

	// Two consequences the refund-only dialog explicitly does not have, and the
	// only thing on screen that tells the two dialogs apart.
	it('says the slot goes to the waitlist and the member hears about it', async () => {
		await expect.element(await open()).toBeVisible();

		await expect
			.element(page.getByText('The slot is released to the waitlist', { exact: false }))
			.toBeVisible();
	});

	// Without this the cancellation names no reservation and the handler
	// cancels nothing — a submit that looks like it worked.
	it('carries the reservation id into the form', async () => {
		await open();

		const hidden = document.querySelector('[role="dialog"] input[name="id"]') as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('res-5');
	});
});
