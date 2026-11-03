import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { formatCents } from '$lib/utils/format';

const DoorSalesCard = (await import('./DoorSalesCard.svelte')).default;

const none = { card: { tickets: 0, grossCents: 0 }, free: { tickets: 0 } };
const sold = { card: { tickets: 3, grossCents: 4500 }, free: { tickets: 2 } };
const tillLink = 'a[href*="/member/volunteer/door?event=evt-1"]';

describe('DoorSalesCard', () => {
	it("shows the show's card takings and free let-ins", async () => {
		const { container, locator } = await render(DoorSalesCard, {
			eventId: 'evt-1',
			takings: sold,
			open: false
		});

		// The heading carries the admitted total: card plus free.
		const admitted = sold.card.tickets + sold.free.tickets;
		await expect.element(locator.getByRole('heading')).toHaveTextContent(String(admitted));
		expect(container.textContent).toContain(formatCents(sold.card.grossCents));
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
});
