import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

// "Your events" holds the member's own listings and their bands' events (#3132).

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

let data: Record<string, unknown>;
vi.mock('#lib/remote/community-events.remote.js', () => ({
	getMyListings: () => Promise.resolve(data)
}));

const { default: MyListingsSection } = await import('./MyListingsSection.svelte');

const row = (id: string, days: number) => ({
	id,
	title: `Show ${id}`,
	status: 'draft',
	startsAt: at(days),
	endsAt: null,
	location: null,
	posterUrl: null
});

const hrefs = () => [...document.querySelectorAll('li a')].map((a) => a.getAttribute('href') ?? '');

describe('MyListingsSection', () => {
	it("lists the member's own and their band's events by date, each band event linking to the band panel", async () => {
		data = {
			listings: [row('own', 5)],
			rejected: [],
			bandEvents: [{ ...row('gig', 2), band: { name: 'Duo', slug: 'duo' } }],
			standing: { status: 'none' }
		};
		await render(MyListingsSection);

		await expect.poll(hrefs).toEqual(['/band/duo/events/gig', '/member/events/own/manage']);
		expect(document.querySelectorAll('[data-band-event]')).toHaveLength(1);
	});

	it('shows the empty state only when there is neither', async () => {
		data = { listings: [], rejected: [], bandEvents: [], standing: { status: 'none' } };
		await render(MyListingsSection);

		await expect.element(page.getByCss('section')).toBeInTheDocument();
		expect(document.querySelectorAll('li')).toHaveLength(0);
	});
});
