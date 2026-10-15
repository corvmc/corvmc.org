import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import AvatarStack from './AvatarStack.svelte';

const acts = ['Sunbathers', 'Moth Club', 'Low Tide', 'Fernwood', 'Quiet Hours'].map((name) => ({
	name
}));

describe('AvatarStack', () => {
	it('draws up to max and counts the rest, the ones never sent included', async () => {
		const { body } = await render(AvatarStack, {
			props: { items: acts.slice(0, 4), total: 6, max: 3 }
		});
		expect(body.match(/class="avatar /g)).toHaveLength(3);
		expect(body).toContain('+3');
		expect(body).toContain('aria-label="Sunbathers, Moth Club, Low Tide, Fernwood and 2 more"');
	});

	it('shows no count when everyone is drawn', async () => {
		const { body } = await render(AvatarStack, { props: { items: acts.slice(0, 2) } });
		expect(body.match(/class="avatar /g)).toHaveLength(2);
		expect(body).not.toMatch(/\+\d/);
	});
});
