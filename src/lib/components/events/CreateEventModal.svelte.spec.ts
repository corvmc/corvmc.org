import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/remote/events.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	});
	return {
		createEvent: {
			enhance: () => ({ method: 'POST', action: '?/createEvent' }),
			fields,
			result: undefined
		},
		checkConflicts: vi.fn(async () => ({ conflicts: [] })),
		getProgramGroups: vi.fn(async () => []),
		previewRecurringEvents: vi.fn(async () => ({ dates: [], totalInWindow: 0 }))
	};
});

vi.mock('$lib/remote/venues.remote', () => ({ getVenueOptions: vi.fn(async () => []) }));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CreateEventModal = (await import('./CreateEventModal.svelte')).default;
const { checkConflicts } = await import('$lib/remote/events.remote');

describe('CreateEventModal', () => {
	it('lets staff give the event an address line, which createEvent accepts as location', async () => {
		await render(CreateEventModal, { open: true });

		const input = page.getByRole('textbox', { name: 'Address line' });
		await expect.element(input).toBeVisible();
		await expect.element(input).toHaveAttribute('name', 'location');
	});

	// #1866: the conflict check's await held back an effect that seeded the
	// window, so the late seed overwrote what staff typed in the meantime.
	it('keeps a reservation time typed while the conflict check is still out', async () => {
		vi.mocked(checkConflicts).mockImplementation(
			() => new Promise((r) => setTimeout(() => r({ conflicts: [] } as never), 300)) as never
		);
		await render(CreateEventModal, { open: true });

		const start = page.getByLabelText('Reservation start');
		const end = page.getByLabelText('Reservation end');
		await page.getByLabelText('Start time').fill('19:00');
		await page.getByLabelText('End time').fill('22:00');
		await page.getByLabelText('Reserve practice space').click();

		await start.fill('18:00');
		await end.fill('23:00');
		await new Promise((r) => setTimeout(r, 800));
		await expect.element(start).toHaveValue('18:00');
		await expect.element(end).toHaveValue('23:00');

		await page.getByLabelText('Start time').fill('17:00');
		await page.getByLabelText('End time').fill('20:00');
		await expect.element(start).toHaveValue('16:00');
		await expect.element(end).toHaveValue('21:00');
	});
});
