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
		updateEvent: {
			enhance: () => ({ method: 'POST', action: '?/updateEvent' }),
			fields,
			result: undefined
		},
		checkRebook: vi.fn(async () => ({ needed: false })),
		checkConflicts: vi.fn(async () => ({ conflicts: [] }))
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ListingEditForm = (await import('./ListingEditForm.svelte')).default;

function listing(source: string, ticketingEnabled: boolean) {
	return {
		id: 'evt-1',
		title: 'A show',
		description: null,
		tags: null,
		kind: 'show',
		source,
		location: null,
		venueId: null,
		externalTicketUrl: null,
		startsAt: new Date('2026-11-14T03:00:00Z'),
		endsAt: new Date('2026-11-14T06:00:00Z'),
		doorsAt: null,
		ticketingEnabled,
		ticketPrice: 1500,
		ticketPriceFloorCents: 0,
		ticketQuantity: 80
	};
}

const props = (source: string, ticketingEnabled: boolean) => ({
	event: listing(source, ticketingEnabled),
	linkedReservation: null,
	venues: [],
	onsaved: () => {},
	oncancel: () => {}
});

describe('ListingEditForm ticketing', () => {
	// A premium band sells its own gig through the collective (#1556). A staff
	// edit that posted `ticketingEnabled=false` closed that sale and dropped its
	// capacity, so the flag is not posted at all for a listing CMC doesn't sell.
	it("leaves a band's own sale alone", async () => {
		const { container } = await render(ListingEditForm, props('band', true));

		// The custom-input fields label by legend, so the inputs are found by id.
		await expect.element(page.getByText('Edit listing')).toBeVisible();
		expect(container.querySelector('#editTitle')).not.toBeNull();
		expect(container.querySelector('input[name="ticketingEnabled"]')).toBeNull();
		expect(container.querySelector('input[name="ticketQuantity"]')).toBeNull();
		await expect.element(page.getByText('Sell tickets through the site')).not.toBeInTheDocument();
	});

	it('offers a CMC listing the toggle, and posts it', async () => {
		const { container } = await render(ListingEditForm, props('cmc', true));

		await expect.element(page.getByText('Sell tickets through the site')).toBeVisible();
		const flag = container.querySelector<HTMLInputElement>('input[name="ticketingEnabled"]');
		expect(flag).not.toBeNull();
		expect(container.querySelector<HTMLInputElement>('#editTicketQuantity')?.value).toBe('80');
	});
});
