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
		compTickets: { enhance: () => ({ method: 'POST' }), fields, result: undefined }
	};
});

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ListingTicketing = (await import('./ListingTicketing.svelte')).default;

const ATTENDEE = 'Ada Lovelace';
const purchaseLink = 'a[href$="/events/evt-1/tickets"]';

function props(source: string, ticketingEnabled: boolean) {
	return {
		event: {
			id: 'evt-1',
			status: 'published',
			source,
			ticketingEnabled,
			ticketPrice: 1500,
			ticketPriceFloorCents: null,
			ticketQuantity: 80,
			externalTicketUrl: null
		},
		ticketStats: ticketingEnabled ? { sold: 3, remaining: 77 } : null,
		ticketMoney: null,
		tickets: ticketingEnabled
			? [
					{
						id: 't1',
						attendeeName: ATTENDEE,
						attendeeEmail: 'ada@example.com',
						code: 'ABC123',
						status: 'valid',
						unitPriceCents: 1500,
						contributionCents: 0,
						actsCents: 0,
						collectiveCents: 0,
						discountWaived: false
					}
				]
			: []
	};
}

describe('ListingTicketing', () => {
	it('shows a CMC sale its stats, comps and ticket list', async () => {
		const { container, locator } = await render(ListingTicketing, props('cmc', true));

		await expect.element(locator.getByText(String(80))).toBeVisible();
		await expect.element(locator.getByText(String(77))).toBeVisible();
		// Comp Tickets is the card's only button.
		await expect.element(locator.getByRole('button')).toBeVisible();
		await expect.element(locator.getByText(ATTENDEE)).toBeVisible();
		expect(container.querySelector(purchaseLink)).not.toBeNull();
	});

	// A band's own sale (#1203) is monitored here but is not CMC's to comp.
	it("monitors a band's own sale without offering comps", async () => {
		const { locator } = await render(ListingTicketing, props('band', true));

		await expect.element(locator.getByText(ATTENDEE)).toBeVisible();
		await expect.element(locator.getByRole('button')).not.toBeInTheDocument();
	});

	it('offers no platform-ticketing controls on a non-CMC listing that is not selling', async () => {
		const { container, locator } = await render(ListingTicketing, props('community', false));

		await expect.element(locator.getByRole('heading')).toBeVisible();
		await expect.element(locator.getByText(String(80))).not.toBeInTheDocument();
		await expect.element(locator.getByRole('button')).not.toBeInTheDocument();
		expect(container.querySelector(purchaseLink)).toBeNull();
	});
});
