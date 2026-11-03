import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ListingQrCard from './ListingQrCard.svelte';

/**
 * The code goes on printed posters, so it must encode the public event page on
 * the site's own origin, and the downloads must be files a print shop can use.
 */

const origin = 'https://corvmc.org';

describe('ListingQrCard', () => {
	it('encodes the public event page and shows the link it encodes', async () => {
		const screen = await render(ListingQrCard, {
			eventId: 'evt-1',
			title: 'Spring Workshop',
			published: true,
			origin
		});

		const encoded = `${origin}/events/evt-1`;
		await expect.element(screen.getByText(encoded)).toBeVisible();
		expect(document.querySelector('[data-testid="listing-qr"] svg')).not.toBeNull();
	});

	it('offers SVG and PNG downloads named after the listing', async () => {
		const screen = await render(ListingQrCard, {
			eventId: 'evt-1',
			title: 'Spring Workshop',
			published: true,
			origin
		});

		const svg = screen.locator.getByRole('link');
		await expect.element(svg).toHaveAttribute('download', 'spring-workshop-qr.svg');
		expect(svg.element().getAttribute('href')).toMatch(/^data:image\/svg\+xml/);
		// Copy link, and the PNG download (drawn on demand, so it is a button).
		expect(screen.locator.getByRole('button').elements()).toHaveLength(2);
	});

	it('warns that the link does not work until the listing is published', async () => {
		const screen = await render(ListingQrCard, {
			eventId: 'evt-1',
			title: 'Spring Workshop',
			published: false,
			origin
		});

		await expect.element(screen.getByRole('alert')).toBeVisible();
	});
});
