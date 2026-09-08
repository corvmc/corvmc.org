import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The only action picking between two *different* remote forms, and the two do
 * different things with money: `payForReservation` charges the member at the
 * screen, `confirmReservation` spends the reservation owner's free hours. One
 * boolean chooses, and the wrong branch shows only once somebody is charged or
 * credited. Pinned here: which handler the submit reaches, and what comes with
 * it.
 */

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});

const remoteForm = (name: string, fields: Record<string, unknown>) => ({
	enhance: () => ({ method: 'POST', action: `?/${name}` }),
	fields: { ...fields, allIssues: () => null },
	result: undefined
});

vi.mock('$lib/remote/reservations.remote', () => ({
	confirmReservation: remoteForm('confirmReservation', { id: field('id') }),
	payForReservation: remoteForm('payForReservation', {
		id: field('id'),
		coverFees: field('coverFees')
	}),
	// Both steps quote the price themselves. A balance is left owing so the
	// member branch reaches its Pay Ahead offer, which only appears when there
	// is something to pay.
	getReservationPricing: vi.fn(async () => ({
		durationHours: 2,
		hourlyRateCents: 1500,
		totalCents: 3000,
		freeHoursBalance: 0,
		creditsApplicable: 0,
		creditDiscountCents: 0,
		remainingCents: 3000,
		isSustainingMember: false
	})),
	previewRecurringInstances: vi.fn(async () => ({ dates: [], totalInWindow: 0 }))
}));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ConfirmReservationAction = (await import('./ConfirmReservationAction.svelte')).default;

const reservation = {
	id: 'res-9',
	startsAt: new Date('2026-03-14T19:00:00Z'),
	endsAt: new Date('2026-03-14T21:00:00Z')
} as never;

const submitsTo = () =>
	(document.querySelector('[role="dialog"] form') as HTMLFormElement).getAttribute('action');

const open = async (props: Record<string, unknown> = {}) => {
	await render(ConfirmReservationAction, { reservation, ...props });
	await page.getByRole('button', { name: 'Confirm' }).first().click();
	return page.getByRole('dialog');
};

describe('ConfirmReservationAction', () => {
	// The whole point of the component. A staff confirmation must not go through
	// the member's checkout, and a member's must not commit somebody's credits.
	it('sends a member confirmation to the payment handler', async () => {
		await expect.element(await open()).toBeVisible();

		expect(submitsTo()).toBe('?/payForReservation');
	});

	it('sends a staff confirmation to the confirm handler', async () => {
		await expect.element(await open({ staff: true })).toBeVisible();

		expect(submitsTo()).toBe('?/confirmReservation');
	});

	// Comp waives the charge outright without spending the member's free hours.
	// It is staff's to give, so it exists only on the staff branch.
	it('offers Comp to staff and to nobody else', async () => {
		await open({ staff: true });

		await expect.element(page.getByRole('button', { name: 'Comp' })).toBeVisible();
	});

	it('gives a member no way to comp their own booking', async () => {
		await expect.element(await open()).toBeVisible();

		expect(document.querySelector('[role="dialog"] button[name="comp"]')).toBeNull();
	});

	/**
	 * Pay Ahead advances to the payment step, which exists only in the member
	 * branch — staff have no checkout to advance into, so offering it there
	 * would step into a form that was never rendered.
	 */
	it('offers Pay Ahead to a member with a balance owing', async () => {
		await open();

		await expect.element(page.getByRole('button', { name: 'Pay Ahead' })).toBeVisible();
	});

	it('offers staff no payment step to advance into', async () => {
		await open({ staff: true });

		// The price has to have landed first, or the absence below is just the
		// skeleton that has not been replaced yet.
		await expect.element(page.getByText('2 hr', { exact: false })).toBeVisible();
		expect(document.querySelector('[role="dialog"] input[name="coverFees"]')).toBeNull();
	});

	// Without this the confirmation names no reservation and the handler
	// confirms nothing — a submit that looks like it worked.
	// One test per branch rather than a loop: a second `render` leaves the first
	// modal mounted over the page, and the next trigger click times out on it.
	for (const staff of [false, true]) {
		it(`carries the reservation id into the ${staff ? 'staff' : 'member'} form`, async () => {
			await expect.element(await open({ staff })).toBeVisible();

			const hidden = document.querySelector('[role="dialog"] input[name="id"]') as HTMLInputElement;
			expect(hidden.type).toBe('hidden');
			expect(hidden.value).toBe('res-9');
		});
	}
});
