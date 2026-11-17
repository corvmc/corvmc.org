import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
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

	it('leaves a child action at full strength', async () => {
		const children = createRawSnippet(() => ({
			render: () => '<div><p>Empty</p><button type="button">Add</button></div>'
		}));
		const { container } = await render(EmptyState, { children });
		let el: Element | null = container.querySelector('button');
		expect(el).not.toBeNull();
		for (; el && el !== container; el = el.parentElement) {
			expect(el.className).not.toMatch(/opacity-/);
			expect(getComputedStyle(el).opacity).toBe('1');
		}
	});

	it('renders no body without a description', async () => {
		const { container } = await render(EmptyState, { title: 'No bands' });
		expect(container.querySelectorAll('p')).toHaveLength(1);
	});
});
