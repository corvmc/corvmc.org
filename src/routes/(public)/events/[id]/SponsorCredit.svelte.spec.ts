import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SponsorCredit from './SponsorCredit.svelte';

// A paid placement has to read as one: the disclosure words are on the page,
// and a sponsor's link is marked `sponsored` for search engines too.

describe('SponsorCredit', () => {
	it('discloses the credit as sponsored and links out with rel="sponsored"', async () => {
		await render(SponsorCredit, {
			sponsors: [
				{ name: 'Troubadour Music', website: 'https://troubadour.example', logoUrl: null },
				{ name: 'Block 15', website: null, logoUrl: null }
			]
		});
		await expect.element(page.getByText(/Presented with support from/)).toBeVisible();
		const link = page.getByRole('link', { name: 'Troubadour Music' });
		await expect.element(link).toHaveAttribute('href', 'https://troubadour.example');
		await expect.element(link).toHaveAttribute('rel', expect.stringContaining('sponsored'));
		await expect.element(page.getByText('Block 15')).toBeVisible();
	});

	it("shows a sponsor's logo named for the sponsor", async () => {
		await render(SponsorCredit, {
			sponsors: [{ name: 'Troubadour Music', website: null, logoUrl: 'https://img/logo.png' }]
		});
		await expect.element(page.getByRole('img', { name: 'Troubadour Music' })).toBeVisible();
	});

	it('renders nothing when nobody is credited', async () => {
		const { container } = await render(SponsorCredit, { sponsors: [] });
		expect(container.textContent?.trim()).toBe('');
	});
});
