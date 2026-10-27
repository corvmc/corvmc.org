import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
		getProgramGroups: vi.fn(async () => [{ id: 'g1', name: 'Facilities' }])
	};
});

vi.mock('$lib/remote/productions.remote', () => ({
	createShow: {
		enhance: () => ({ method: 'POST', action: '?/createShow' }),
		fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
			get: (target, key: string) =>
				target[key] ?? {
					as: (type: string, value?: unknown) => ({ type, name: key, value }),
					issues: () => null
				}
		}),
		result: undefined
	}
}));

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

	it('posts a plain listing from the Calendar, with its kind and who runs it', async () => {
		await render(CreateEventModal, { open: true });

		await expect.element(page.getByLabelText('Kind')).toBeVisible();
		await expect.element(page.getByLabelText('Run by')).toBeVisible();
		expect(document.querySelector('form')?.getAttribute('action')).toBe('?/createEvent');
	});

	// #1947: "New production" makes the listing through the same form, as a show
	// with its production, so kind and "Run by" are not the staffer's to pick.
	it('opens a show with its production when asked', async () => {
		await render(CreateEventModal, { open: true, production: true });

		await expect.element(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
		await expect.element(page.getByLabelText('Kind')).not.toBeInTheDocument();
		await expect.element(page.getByLabelText('Run by')).not.toBeInTheDocument();
		expect(document.querySelector('form')?.getAttribute('action')).toBe('?/createShow');
	});

	// #1984: 6pm PDT on Oct 26 is already Oct 27 in UTC.
	describe('at 6pm club time', () => {
		afterEach(() => vi.useRealTimers());

		it('defaults the date to the club day, not the UTC day', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-10-27T01:00:00Z'));
			await render(CreateEventModal, { open: true });

			await expect.element(page.getByLabelText('Date')).toHaveValue('2026-10-26');
		});
	});
});
