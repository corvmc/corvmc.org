import { page, type Locator } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * One field, one input. `FormStep` *hides* an inactive step rather than
 * unmounting it, so every step's hidden inputs are in the form at submit —
 * and two steps that both render `id` post it twice. SvelteKit refuses that
 * outright with `Form cannot contain duplicated keys`, which reached a member
 * as a 500 on the one button that confirms a booking (#1299).
 */
vi.mock('#lib/remote/reservations.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const form = (fields: Record<string, unknown>) => ({
		enhance: () => ({ method: 'POST', action: '?/x' }),
		fields: { ...fields, allIssues: () => null },
		result: undefined
	});
	return {
		payForReservation: form({
			id: field('id'),
			coverFees: field('coverFees'),
			skipPayment: field('skipPayment')
		}),
		confirmReservation: form({ id: field('id'), comp: field('comp') }),
		getReservationPricing: vi.fn(async () => ({
			durationHours: 2,
			hourlyRateCents: 1500,
			totalCents: 3000,
			creditsApplicable: 0,
			remainingCents: 3000
		})),
		previewRecurringInstances: vi.fn(async () => ({ dates: [], totalInWindow: 0 }))
	};
});

vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

vi.mock('#lib/utils/checkout-navigation.js', () => ({ goToCheckout: vi.fn() }));

const ConfirmReservationAction = (await import('./ConfirmReservationAction.svelte')).default;

const reservation = {
	id: 'res-1',
	startsAt: new Date('2026-03-14T19:00:00Z'),
	endsAt: new Date('2026-03-14T21:00:00Z')
};

const openDialog = async (locator: Locator) => {
	// The trigger is the container's only button; the dialog portals out of it.
	await locator.getByRole('button').click();
	return page.getByRole('dialog');
};

/** Every hidden input the form would actually post under `name`. */
const postedValues = (name: string) =>
	[
		...document.querySelectorAll<HTMLInputElement>(
			`[role="dialog"] input:is([name="${name}"], [name^="${name}/"])`
		)
	].map((el) => el.value);

describe('ConfirmReservationAction', () => {
	it('posts the reservation id exactly once for a member', async () => {
		// The member path mounts ConfirmStep *and* PaymentStep, and both used to
		// be handed `fields.id`. Hidden ≠ unmounted, so the form carried two.
		const { locator } = await render(ConfirmReservationAction, { reservation });
		await openDialog(locator);

		expect(postedValues('id')).toEqual(['res-1']);
	});

	it('posts the reservation id exactly once for staff', async () => {
		const { locator } = await render(ConfirmReservationAction, { reservation, staff: true });
		await openDialog(locator);

		expect(postedValues('id')).toEqual(['res-1']);
	});
});
