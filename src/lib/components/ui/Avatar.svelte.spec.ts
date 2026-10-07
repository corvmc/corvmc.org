import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Avatar from './Avatar.svelte';

// A 1x1 PNG, so the image loads without a network.
const PIXEL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** The initials pattern shows until the image loads, and stays if it fails. */
describe('Avatar fallback', () => {
	it('shows the initials when there is no image', async () => {
		const { container } = await render(Avatar, { name: 'Ada Lovelace' });

		expect(container.querySelector('img')).toBeNull();
		expect(container.textContent).toContain('AL');
	});

	it('swaps the initials for the image once it loads', async () => {
		const { container } = await render(Avatar, { name: 'Ada Lovelace', src: PIXEL });

		await expect.poll(() => container.querySelector('.avatar-initials')).toBeNull();
		expect(container.querySelector('img')?.style.display).toBe('');
	});

	it('keeps the initials and hides the image when it fails', async () => {
		const { container } = await render(Avatar, {
			name: 'Ada Lovelace',
			src: 'data:image/png;base64,broken'
		});
		const img = container.querySelector('img')!;

		await expect.poll(() => img.complete).toBe(true);
		expect(container.textContent).toContain('AL');
		expect(img.style.display).toBe('none');
	});
});
