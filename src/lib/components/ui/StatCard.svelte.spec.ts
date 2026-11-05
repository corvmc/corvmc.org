import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StatCard from './StatCard.svelte';
// The `client` project ships no CSS, and overflow is a layout outcome.
import '../../../routes/layout.css';

describe('StatCard', () => {
	it('keeps a long title inside a card narrower than the title', async () => {
		const host = document.createElement('div');
		host.style.width = '160px';
		document.body.append(host);

		await render(StatCard, {
			target: host,
			props: { title: 'A title much longer than its card is wide', value: 3 }
		});

		const card = host.querySelector('.stat') as HTMLElement;
		const title = host.querySelector('.stat-title') as HTMLElement;
		expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
			card.getBoundingClientRect().right
		);
		expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth);

		host.remove();
	});
});
