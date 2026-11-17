import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NoBandsCard from './NoBandsCard.svelte';

// The dashboard's way into bands for a member in none (#3137).

describe('NoBandsCard', () => {
	it('renders nothing once the member is in a band', async () => {
		const { container } = await render(NoBandsCard, { bandCount: 1 });

		expect(container.querySelector('[data-testid="no-bands"]')).toBeNull();
	});

	it('offers creating a band and browsing bands to a member in none', async () => {
		const { container } = await render(NoBandsCard, { bandCount: 0 });

		const hrefs = [...container.querySelectorAll('[data-testid="no-bands"] a')].map((a) =>
			a.getAttribute('href')
		);
		expect(hrefs).toEqual(['/member/bands?create=1', '/member/directory/bands']);
	});
});
