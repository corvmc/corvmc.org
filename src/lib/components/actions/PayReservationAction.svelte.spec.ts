import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';

/**
 * Where the member goes after paying. `payForReservation` answers one of two
 * ways — a Stripe URL to leave for, or a booking already settled from credits
 * — and this component is the only thing that tells them apart. Sending a
 * paying member to `invalidateAll` leaves them on an unpaid booking with no
 * error, which is the failure nothing else here can catch.
 */

const goToCheckout = vi.fn();
const invalidateAll = vi.fn();

let submitResult: unknown;

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});

/**
 * Faithful in the one respect that matters: SvelteKit's instance exposes only
 * `method`, `action` and an attachment as enumerable properties, and the
 * attachment is what intercepts the submit. Without it the form navigates and
 * `onsuccess` never runs. Adapted from `ui/Action.svelte.spec.ts`.
 */
function fakeRemoteForm(fields: Record<string, unknown>) {
	let callback: ((instance: { submit: () => Promise<boolean> }) => unknown) | null = null;
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/pay' };

	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			void callback?.({
				submit: async () => {
					instance.result = submitResult;
					return true;
				}
			});
		};
		form.addEventListener('submit', onsubmit);
		return () => form.removeEventListener('submit', onsubmit);
	};

	Object.defineProperties(instance, {
		fields: { value: { ...fields, allIssues: () => null } },
		result: { value: undefined, writable: true },
		enhance: {
			value: (cb: (instance: { submit: () => Promise<boolean> }) => unknown) => {
				callback = cb;
				return instance;
			}
		}
	});

	return instance;
}

vi.mock('$lib/remote/reservations.remote', () => ({
	payForReservation: fakeRemoteForm({ id: field('id'), coverFees: field('coverFees') }),
	getReservationPricing: vi.fn(async () => ({
		durationHours: 2,
		hourlyRateCents: 1500,
		totalCents: 3000,
		creditsApplicable: 0,
		remainingCents: 3000
	}))
}));

vi.mock('$app/navigation', () => ({
	invalidateAll,
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

vi.mock('$lib/utils/checkout-navigation', () => ({ goToCheckout }));

const PayReservationAction = (await import('./PayReservationAction.svelte')).default;

const reservation = {
	id: 'res-9',
	startsAt: new Date('2026-03-14T19:00:00Z'),
	endsAt: new Date('2026-03-14T21:00:00Z')
};

async function payWith(result: unknown) {
	submitResult = result;
	await render(PayReservationAction, { reservation });
	await page.getByRole('button', { name: 'Pay Now' }).first().click();
	await expect.element(page.getByRole('dialog')).toBeVisible();
	// PaymentStep owns the submit — the action passes `noFooter`. Its label
	// carries the amount, so it is matched on the prefix.
	await page.getByRole('button', { name: /^Pay \$/ }).click();
}

describe('PayReservationAction', () => {
	beforeEach(() => {
		goToCheckout.mockClear();
		invalidateAll.mockClear();
	});

	it('leaves for Stripe when the server hands back a checkout URL', async () => {
		await payWith({ redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });

		await vi.waitFor(() =>
			expect(goToCheckout).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1')
		);
		expect(invalidateAll).not.toHaveBeenCalled();
	});

	// Credits covered it, so there is nothing to pay and nowhere to go — the
	// page just has to stop showing it as unpaid.
	it('refreshes in place when the booking was settled without a charge', async () => {
		await payWith({ paid: true });

		await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
		expect(goToCheckout).not.toHaveBeenCalled();
	});
});
