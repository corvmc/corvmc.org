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
		getProgramGroups: vi.fn(async () => [])
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CreateEventModal = (await import('./CreateEventModal.svelte')).default;

describe('CreateEventModal', () => {
	// #1822's rule: the modal holds what the row cannot exist without, and the
	// event page holds the rest.
	it('asks only for what the row needs', async () => {
		await render(CreateEventModal, { open: true });

		await expect.element(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
		await expect.element(page.getByLabelText('Date')).toBeVisible();
		await expect.element(page.getByLabelText('Start time')).toBeVisible();
		await expect.element(page.getByLabelText('End time')).toBeVisible();

		for (const gone of ['Description', 'Doors time', 'Tags', 'Address line', 'Ticket price ($)']) {
			await expect.element(page.getByLabelText(gone)).not.toBeInTheDocument();
		}
		await expect.element(page.getByText('Reserve practice space')).not.toBeInTheDocument();
		await expect.element(page.getByText('Repeat this event')).not.toBeInTheDocument();
	});

	it('names itself after the trigger that opened it', async () => {
		await render(CreateEventModal, {
			open: true,
			title: 'Create Listing',
			submitLabel: 'Create Listing'
		});

		await expect.element(page.getByRole('heading', { name: 'Create Listing' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Create Listing' })).toBeVisible();
	});
});
