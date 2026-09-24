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

describe('CreateEventModal', () => {
	it('lets staff give the event an address line, which createEvent accepts as location', async () => {
		await render(CreateEventModal, { open: true });

		const input = page.getByRole('textbox', { name: 'Address line' });
		await expect.element(input).toBeVisible();
		await expect.element(input).toHaveAttribute('name', 'location');
	});
});
