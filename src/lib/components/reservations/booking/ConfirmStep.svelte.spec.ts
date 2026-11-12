import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { getReservationPricing } from '#lib/remote/reservations.remote.js';
import '#lib/test/locators.js';

vi.mock('#lib/remote/reservations.remote.js', () => ({
	getReservationPricing: vi.fn(),
	previewRecurringInstances: vi.fn(async () => ({ dates: [], totalInWindow: 0 }))
}));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const Harness = (await import('./ConfirmStep.test.svelte')).default;

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});
const remote = {
	enhance: () => ({ method: 'POST', action: '?/book' }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	}),
	result: undefined
};

// The names kit 3 renders: `<key>/<module hash>/<export>`.
const values = {
	'date/1a2b3c/bookAndPayReservation': '2026-11-20',
	'startTime/1a2b3c/bookAndPayReservation': '18:00',
	'endTime/1a2b3c/bookAndPayReservation': '20:00'
};

const pricing = vi.mocked(getReservationPricing);

async function continueToConfirm() {
	await render(Harness, { remote: remote as never, values });
	await page.getByCss('[data-step="0"] button').click();
}

describe('ConfirmStep', () => {
	beforeEach(() => {
		pricing.mockReset();
	});

	// #2571: the step read `date` by bare name and never priced the slot.
	it('prices the slot the first step holds', async () => {
		pricing.mockResolvedValue({
			durationHours: 2,
			hourlyRateCents: 1500,
			totalCents: 3000,
			creditsApplicable: 0,
			remainingCents: 3000
		} as never);
		await continueToConfirm();

		await expect.element(page.getByTestId('confirm-slot')).toBeVisible();
		await expect.element(page.getByTestId('confirm-pricing')).toBeVisible();
		expect(pricing).toHaveBeenCalledWith(
			expect.objectContaining({ date: '2026-11-20', startTime: '18:00', endTime: '20:00' })
		);
	});

	it('says the price did not load when the request fails', async () => {
		pricing.mockRejectedValue(new Error('offline') as never);
		await continueToConfirm();

		await expect.element(page.getByTestId('confirm-pricing-error')).toBeVisible();
	});
});
