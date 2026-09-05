import { describe, it, expect } from 'vitest';
import {
	blockIsEmpty,
	blocksForPreview,
	BLOCK_SOURCES,
	type BlockContentContext
} from './block-editing';
import { PRESET_ORDER } from '$lib/utils/band-site-preset';
import type { Block } from '$lib/types/band-page';

/** A band with nothing filled in anywhere. */
const BARE: BlockContentContext = {
	bandLinks: 0,
	bandBio: null,
	members: 0,
	events: 0,
	pastEvents: 0,
	galleryImages: 0,
	pressQuotes: 0,
	achievements: 0,
	hasContact: false,
	hasStagePlot: false,
	hasRider: false
};

/** A band that has filled in everything. */
const FULL: BlockContentContext = {
	bandLinks: 3,
	bandBio: '<p>hi</p>',
	members: 4,
	events: 2,
	pastEvents: 9,
	galleryImages: 6,
	pressQuotes: 1,
	achievements: 2,
	hasContact: true,
	hasStagePlot: true,
	hasRider: true
};

function block<T extends Block['type']>(type: T, extra: Record<string, unknown> = {}): Block {
	const base = { id: `preset:${type}`, type, ...extra };
	// Fill the required fields each variant carries.
	const defaults: Record<string, Record<string, unknown>> = {
		hero: { imageKey: '' },
		bio: { content: '' },
		links: { style: 'buttons' },
		members: { showPositions: true },
		events: {},
		gallery: { imageKeys: [] },
		embed: { platform: '', url: '' },
		press: {},
		achievements: {},
		contact: {},
		tech_rider: {},
		custom_html: { content: '' },
		merch: { items: [] },
		spacer: { height: 'md' }
	};
	return { ...defaults[type], ...base } as Block;
}

describe('blockIsEmpty', () => {
	it('reports every gated block empty for a band with nothing', () => {
		const empties = PRESET_ORDER.filter((type) => blockIsEmpty(block(type), BARE));
		// Hero falls back to the band name and contact shows its form by default,
		// so those two always render. Everything else in the preset is gated.
		expect(empties).toEqual([
			'bio',
			'links',
			'embed',
			'events',
			'members',
			'gallery',
			'press',
			'achievements',
			'tech_rider',
			'merch',
			'custom_html'
		]);
	});

	it('reports nothing empty for a band that has filled everything in', () => {
		const filled: Partial<Record<Block['type'], Record<string, unknown>>> = {
			bio: { content: '<p>about us</p>' },
			embed: { platform: 'spotify', url: 'https://open.spotify.com/album/1' },
			gallery: { imageKeys: ['a.jpg'] },
			custom_html: { content: '<b>hi</b>' },
			merch: { items: [{ title: 'LP', url: 'https://shop.example/lp' }] }
		};
		for (const type of PRESET_ORDER) {
			expect(blockIsEmpty(block(type, filled[type] ?? {}), FULL), type).toBe(false);
		}
	});

	it('never calls the hero or a spacer empty — both always render something', () => {
		expect(blockIsEmpty(block('hero'), BARE)).toBe(false);
		expect(blockIsEmpty(block('spacer'), BARE)).toBe(false);
	});

	it('falls back to the band profile bio before calling the bio block empty', () => {
		expect(blockIsEmpty(block('bio'), { ...BARE, bandBio: '<p>from the profile</p>' })).toBe(false);
	});

	it('counts a whitespace-only bio as empty', () => {
		expect(blockIsEmpty(block('bio', { content: '   \n ' }), BARE)).toBe(true);
	});

	it('keeps an events block that has only past shows to list', () => {
		const ctx = { ...BARE, pastEvents: 4 };
		expect(blockIsEmpty(block('events', { showPast: true }), ctx)).toBe(false);
		// ...but past shows it was never asked to list do not save it.
		expect(blockIsEmpty(block('events'), ctx)).toBe(true);
	});

	it('keeps a gallery whose images are pinned on the block itself', () => {
		expect(blockIsEmpty(block('gallery', { imageKeys: ['x.jpg'] }), BARE)).toBe(false);
	});

	it('keeps the contact block while its form is on, even with no contacts', () => {
		expect(blockIsEmpty(block('contact'), BARE)).toBe(false);
		expect(blockIsEmpty(block('contact', { showForm: false }), BARE)).toBe(true);
		// A published contact carries it even with the form off.
		expect(blockIsEmpty(block('contact', { showForm: false }), { ...BARE, hasContact: true })).toBe(
			false
		);
	});

	it('keeps the tech rider when either file is uploaded', () => {
		expect(blockIsEmpty(block('tech_rider'), { ...BARE, hasStagePlot: true })).toBe(false);
		expect(blockIsEmpty(block('tech_rider'), { ...BARE, hasRider: true })).toBe(false);
	});
});

describe('BLOCK_SOURCES', () => {
	it('names a source for every block type', () => {
		for (const type of PRESET_ORDER) {
			expect(BLOCK_SOURCES[type], type).toBeDefined();
			expect(BLOCK_SOURCES[type].action, type).not.toBe('');
		}
	});

	it('gives an owning route to exactly the blocks the band does not write here', () => {
		const derived = Object.entries(BLOCK_SOURCES)
			.filter(([, s]) => s.owner !== null)
			.map(([type]) => type)
			.sort();
		expect(derived).toEqual([
			'achievements',
			'contact',
			'events',
			'links',
			'members',
			'press',
			'tech_rider'
		]);
	});
});

describe('blocksForPreview', () => {
	it('resolves image keys without touching the blocks that were passed in', () => {
		const blocks = [block('hero', { imageKey: 'bands/1/hero.jpg' })];
		const out = blocksForPreview(blocks, { 'bands/1/hero.jpg': 'https://cdn.test/hero.jpg' });

		expect(out[0]).toMatchObject({ imageKey: 'https://cdn.test/hero.jpg' });
		// The editable array is what gets saved; resolving into it would write a URL
		// into the R2 key column.
		expect(blocks[0]).toMatchObject({ imageKey: 'bands/1/hero.jpg' });
	});

	it('leaves an unresolvable hero key alone rather than blanking it', () => {
		const out = blocksForPreview([block('hero', { imageKey: 'missing.jpg' })], {});
		expect(out[0]).toMatchObject({ imageKey: 'missing.jpg' });
	});

	it('drops gallery keys it cannot resolve', () => {
		const out = blocksForPreview([block('gallery', { imageKeys: ['a.jpg', 'b.jpg'] })], {
			'a.jpg': 'https://cdn.test/a.jpg'
		});
		expect(out[0]).toMatchObject({ imageKeys: ['https://cdn.test/a.jpg'] });
	});

	it('resolves merch item images and leaves imageless items as they are', () => {
		const out = blocksForPreview(
			[
				block('merch', {
					items: [
						{ title: 'LP', url: 'https://shop.test/lp', imageKey: 'lp.jpg' },
						{ title: 'Tee', url: 'https://shop.test/tee' }
					]
				})
			],
			{ 'lp.jpg': 'https://cdn.test/lp.jpg' }
		);
		const items = (out[0] as Extract<Block, { type: 'merch' }>).items;
		expect(items[0].imageKey).toBe('https://cdn.test/lp.jpg');
		expect(items[1].imageKey).toBeUndefined();
	});

	it('sanitizes authored HTML for display but not for saving', () => {
		const blocks = [block('custom_html', { content: '<b>ok</b><script>alert(1)</script>' })];
		const out = blocksForPreview(blocks, {});

		expect((out[0] as Extract<Block, { type: 'custom_html' }>).content).not.toContain('<script>');
		expect((blocks[0] as Extract<Block, { type: 'custom_html' }>).content).toContain('<script>');
	});

	it('keeps order, ids and hidden blocks so the editor can index by position', () => {
		const blocks = [block('hero'), block('bio', { hidden: true }), block('merch')];
		const out = blocksForPreview(blocks, {});
		expect(out.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
		expect(out[1].hidden).toBe(true);
	});
});
