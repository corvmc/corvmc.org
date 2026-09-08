import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Half of a pair sitting side by side in the staff booking row, differing by one
 * word. Both refund; only the other cancels. The money moves either way, so the
 * refund landing is no signal the right button was pressed.
 * `refundAndCancelReservation` is mocked here too, so a component reaching for
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
		refundOnlyReservation: remoteForm('refundOnlyReservation'),
		refundAndCancelReservation: remoteForm('refundAndCancelReservation')
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

const RefundOnlyReservationAction = (await import('./RefundOnlyReservationAction.svelte')).default;

const reservation = {
	id: 'res-4',
	startsAt: new Date('2026-03-14T19:00:00Z'),
	endsAt: new Date('2026-03-14T21:00:00Z'),
	memberName: 'Jane Doe'
} as never;

const open = async () => {
	await render(RefundOnlyReservationAction, { reservation });
	await page.getByRole('button', { name: 'Refund only' }).click();
	return page.getByRole('dialog');
};

describe('RefundOnlyReservationAction', () => {
	it('refunds through the handler that leaves the booking alone', async () => {
		await expect.element(await open()).toBeVisible();

		const form = document.querySelector('[role="dialog"] form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/refundOnlyReservation');
	});

	// The distinguishing sentence. Two identical-looking dialogs a click apart
	// need the difference stated, not implied by the button label.
	it('says the booking survives the refund', async () => {
		await expect.element(await open()).toBeVisible();

		await expect.element(page.getByText('the booking is not cancelled')).toBeVisible();
	});

	// Without this the refund names no reservation and the handler refunds
	// nothing — a submit that looks like it worked.
	it('carries the reservation id into the form', async () => {
		await open();

		const hidden = document.querySelector('[role="dialog"] input[name="id"]') as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('res-4');
	});
});
