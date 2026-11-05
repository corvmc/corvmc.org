import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EmptyState from './EmptyState.svelte';

describe('EmptyState', () => {
	it('renders the action as a link to actionHref', async () => {
		const { container } = await render(EmptyState, {
			title: 'No bands',
			actionLabel: 'Create a band',
			actionHref: '/member/bands'
		});
		const links = container.querySelectorAll('a');
		expect(links).toHaveLength(1);
		expect(links[0].getAttribute('href')).toBe('/member/bands');
	});

	it('renders no link without an action', async () => {
		const { container } = await render(EmptyState, { title: 'No bands' });
		expect(container.querySelector('a')).toBeNull();
	});
});
