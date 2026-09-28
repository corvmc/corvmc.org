import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/remote/reservations.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	});
	const slots = ['17:00', '17:30', '18:00', '18:30', '19:00'].map((startTime) => ({
		startTime,
		available: false
	}));
	return {
		createReservation: {
			enhance: () => ({ method: 'POST', action: '?/createReservation' }),
			fields,
			result: undefined
		},
		searchMembers: vi.fn(async () => []),
		searchBands: vi.fn(async () => []),
		getStaffSlots: vi.fn(async () => ({
			slots,
			config: { slotMinutes: 30, minDurationHours: 1, maxDurationHours: 2 }
		})),
		checkConflicts: vi.fn(async () => ({
			conflicts: [
				{
					type: 'reservation',
					id: 'res-other',
					startsAt: new Date(),
					endsAt: new Date(),
					label: 'Someone Else'
				}
			],
			validationWarnings: []
		}))
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CreateModal = (await import('./CreateModal.svelte')).default;

describe('CreateModal', () => {
	// #1688: the double-booking warning showed, but the submit stayed live.
	it('holds the submit over a double-booking until staff tick the override', async () => {
		await render(CreateModal);
		await page.getByRole('button', { name: 'New Reservation' }).click();

		// Booker type, member search, then the two time selects.
		const combos = page.getByRole('combobox');
		await combos.nth(2).selectOptions('17:00');
		await combos.nth(3).selectOptions('18:00');

		const submit = page.getByRole('button', { name: 'Create Reservation' });
		const override = page.getByRole('checkbox', { name: /Book it anyway/ });
		await expect.element(override).toBeVisible();
		await expect.element(submit).toBeDisabled();

		await override.click();
		await expect.element(submit).toBeEnabled();
	});
});
