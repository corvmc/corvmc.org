import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

const DoorSalesCard = (await import('./DoorSalesCard.svelte')).default;

const none = { card: { tickets: 0, grossCents: 0 }, free: { tickets: 0 } };
const sold = { card: { tickets: 3, grossCents: 4500 }, free: { tickets: 2 } };

describe('DoorSalesCard', () => {
	it("shows the show's card takings and free let-ins", async () => {
		await render(DoorSalesCard, { eventId: 'evt-1', takings: sold, open: false });

		await expect.element(page.getByRole('heading', { name: /Door Sales/ })).toBeVisible();
		await expect.element(page.getByText('$45.00')).toBeVisible();
		await expect.element(page.getByText('3 tickets')).toBeVisible();
		await expect.element(page.getByText('5 admitted')).toBeVisible();
		await expect.element(page.getByRole('link', { name: /Open the till/ })).not.toBeInTheDocument();
	});

	it('links to the till on this show while it is on the door', async () => {
		await render(DoorSalesCard, { eventId: 'evt-1', takings: none, open: true });

		await expect.element(page.getByText('None yet')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: /Open the till/ }))
			.toHaveAttribute('href', expect.stringContaining('/member/volunteer/door?event=evt-1'));
	});

	it('says nothing for a show the door never worked', async () => {
		await render(DoorSalesCard, { eventId: 'evt-1', takings: none, open: false });

		await expect.element(page.getByText('Door Sales')).not.toBeInTheDocument();
	});
});
