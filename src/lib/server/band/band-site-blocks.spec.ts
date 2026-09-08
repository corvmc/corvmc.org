import { describe, it, expect, vi } from 'vitest';
import type { Block } from '$lib/server/db/schema/band-page';

vi.mock('$lib/server/storage', () => ({
	resolveImageUrl: vi.fn((key: string | null | undefined) =>
		key ? `https://media.test/${key}` : null
	)
}));

import { prepareBlocksForRender } from './band-site-blocks';

describe('prepareBlocksForRender', () => {
	it('resolves hero image keys to public URLs', () => {
		const [block] = prepareBlocksForRender([
			{ id: '1', type: 'hero', imageKey: 'bands/x/hero.jpg', headline: 'Hi' }
		]);
		expect(block).toMatchObject({ type: 'hero', imageKey: 'https://media.test/bands/x/hero.jpg' });
	});

	it('resolves merch item image keys', () => {
		const [block] = prepareBlocksForRender([
			{
				id: '1',
				type: 'merch',
				items: [
					{ title: 'Shirt', url: 'https://shop.test/shirt', imageKey: 'bands/x/shirt.jpg' },
					{ title: 'Sticker', url: 'https://shop.test/sticker' }
				]
			}
		]);
		expect(block.type).toBe('merch');
		if (block.type !== 'merch') return;
		expect(block.items[0].imageKey).toBe('https://media.test/bands/x/shirt.jpg');
		expect(block.items[1].imageKey).toBeUndefined();
	});

	it('resolves gallery image keys and drops unresolvable ones', () => {
		const [block] = prepareBlocksForRender([
			{ id: '1', type: 'gallery', imageKeys: ['bands/x/a.jpg', ''] }
		]);
		expect(block.type).toBe('gallery');
		if (block.type !== 'gallery') return;
		expect(block.imageKeys).toEqual(['https://media.test/bands/x/a.jpg']);
	});

	it('sanitizes bio blocks with the tight allowlist', () => {
		const [block] = prepareBlocksForRender([
			{
				id: '1',
				type: 'bio',
				content: '<p>Hello <strong>world</strong></p><script>alert(1)</script>'
			}
		]);
		expect(block.type).toBe('bio');
		if (block.type !== 'bio') return;
		expect(block.content).toContain('<strong>world</strong>');
		expect(block.content).not.toContain('<script>');
	});

	it('strips XSS vectors from custom_html blocks', () => {
		const [block] = prepareBlocksForRender([
			{
				id: '1',
				type: 'custom_html',
				content:
					'<div class="ok"><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a></div>'
			}
		]);
		expect(block.type).toBe('custom_html');
		if (block.type !== 'custom_html') return;
		expect(block.content).toContain('class="ok"');
		expect(block.content).not.toContain('onerror');
		expect(block.content).not.toContain('javascript:');
	});

	it('passes other block types through untouched', () => {
		const input: Block[] = [
			{ id: '1', type: 'events', limit: 5 },
			{ id: '2', type: 'spacer', height: 'md' }
		];
		expect(prepareBlocksForRender(input)).toEqual(input);
	});

	it('drops hidden blocks', () => {
		const out = prepareBlocksForRender([
			{ id: '1', type: 'events', limit: 5, hidden: true },
			{ id: '2', type: 'press' }
		]);
		expect(out.map((b) => b.id)).toEqual(['2']);
	});

	it('never ships an unpublished custom_html block’s markup', () => {
		const out = prepareBlocksForRender([
			{ id: '1', type: 'custom_html', content: '<p>not live yet</p>', hidden: true }
		]);
		expect(out).toEqual([]);
	});
});
