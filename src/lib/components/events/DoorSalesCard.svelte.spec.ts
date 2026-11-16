import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { formatCents } from '#lib/utils/format.js';

const DoorSalesCard = (await import('./DoorSalesCard.svelte')).default;

const noGifts = { count: 0, grossCents: 0 };
const zero = { tickets: 0, grossCents: 0 };
const none = { card: zero, cash: zero, free: zero, donations: noGifts };
const sold = {
	card: { tickets: 3, grossCents: 4500 },
	cash: { tickets: 1, grossCents: 1000 },
	free: { tickets: 2, grossCents: 0 },
	donations: noGifts
};
const tillLink = 'a[href*="/member/volunteer/door?event=evt-1"]';

describe('DoorSalesCard', () => {
	it("shows the show's card takings and free let-ins", async () => {
		const { container, locator } = await render(DoorSalesCard, {
			eventId: 'evt-1',
			takings: sold,
			open: false
		});

		// The heading carries the admitted total: card, cash and free.
		const admitted = sold.card.tickets + sold.cash.tickets + sold.free.tickets;
		await expect.element(locator.getByRole('heading')).toMatchTextContent(String(admitted));
		expect(container.textContent).toContain(formatCents(sold.card.grossCents));
		const cash = container.querySelector('[data-testid="door-cash"]');
		expect(cash?.textContent).toContain(formatCents(sold.cash.grossCents));
		expect(container.querySelector(tillLink)).toBeNull();
	});

	it('links to the till on this show while it is on the door', async () => {
		const { container, locator } = await render(DoorSalesCard, {
			eventId: 'evt-1',
			takings: none,
			open: true
		});

		await expect.element(locator.getByRole('heading')).toBeVisible();
		expect(locator.getByRole('heading').element().textContent).not.toMatch(/\d/);
		expect(container.querySelector(tillLink)).not.toBeNull();
	});

	it('says nothing for a show the door never worked', async () => {
		const { container } = await render(DoorSalesCard, {
			eventId: 'evt-1',
			takings: none,
			open: false
		});

		expect(container.textContent?.trim()).toBe('');
	});

	// Gifts on the door phone are the show's money too (#2799).
	it('shows door donations beside the tickets, even on a night with no sales', async () => {
		const { container } = await render(DoorSalesCard, {
			eventId: 'evt-1',
			takings: { ...none, donations: { count: 2, grossCents: 3000 } },
			open: false
		});

		const gifts = container.querySelector('[data-testid="door-donations"]');
		expect(gifts?.textContent).toContain(formatCents(3000));
	});
});
