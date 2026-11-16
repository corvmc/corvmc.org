import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NextSteps from './NextSteps.svelte';

// A band of one leads with inviting and booking (#3050), until a second member joins.

const hrefs = (container: HTMLElement) =>
	[...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('NextSteps', () => {
	it('links to inviting and booking while the band has one member', async () => {
		const { container } = await render(NextSteps, {
			slug: 'second-thoughts',
			memberCount: 1,
			canManage: true
		});

		expect(hrefs(container)).toEqual([
			'/band/second-thoughts/members',
			'/band/second-thoughts/reservations'
		]);
	});

	it('is gone once a second member joins', async () => {
		const { container } = await render(NextSteps, {
			slug: 'second-thoughts',
			memberCount: 2,
			canManage: true
		});

		expect(container.querySelector('a')).toBeNull();
	});

	it('is not shown to a viewer who cannot invite', async () => {
		const { container } = await render(NextSteps, {
			slug: 'second-thoughts',
			memberCount: 1,
			canManage: false
		});

		expect(container.querySelector('a')).toBeNull();
	});
});
