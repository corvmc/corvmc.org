import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Avatar from './Avatar.svelte';
import EntityAvatar from './entity/EntityAvatar.svelte';

/**
 * Svelte's SSR adds `onload`/`onerror="this.__e=event"` to an `<img>` that has a
 * spread, a `use:` or an inline load/error handler, and the CSP's
 * `script-src-attr 'none'` blocks those attributes on every page an avatar is on.
 */
describe('avatar server rendering', () => {
	it('sends an Avatar image with no inline event handler', async () => {
		const { body } = await render(Avatar, {
			props: { name: 'Ada Lovelace', src: 'https://example.com/a.jpg' }
		});

		expect(body).toContain('<img');
		expect(body).not.toMatch(/\son(load|error)=/);
	});

	it('sends an EntityAvatar image with no inline event handler', async () => {
		const { body } = await render(EntityAvatar, {
			props: { name: 'The Band', image: 'https://example.com/b.jpg' }
		});

		expect(body).toContain('<img');
		expect(body).not.toMatch(/\son(load|error)=/);
	});

	it('still sends the initials pattern underneath the image', async () => {
		const { body } = await render(Avatar, {
			props: { name: 'Ada Lovelace', src: 'https://example.com/a.jpg' }
		});

		expect(body).toContain('>AL</span>');
	});
});
