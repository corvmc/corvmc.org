import { describe, it, expect } from 'vitest';
import type { Block } from '$lib/types/band-page';
import {
	presetBlocks,
	PRESET_ORDER,
	MAX_BLOCKS,
	BLOCK_LABELS,
	reconcileBlocks
} from './band-site-preset';

describe('presetBlocks', () => {
	it('carries one block of every preset type, in preset order', () => {
		expect(presetBlocks().map((b) => b.type)).toEqual([...PRESET_ORDER]);
	});

	it('excludes spacer — there is no position to insert one at any more', () => {
		expect(presetBlocks().some((b) => b.type === 'spacer')).toBe(false);
	});

	it('names every preset type', () => {
		for (const type of PRESET_ORDER) {
			expect(BLOCK_LABELS[type]).toBeDefined();
		}
	});

	it('holds no band content — the renderer falls back to the profile', () => {
		const hero = presetBlocks().find((b) => b.type === 'hero');
		const bio = presetBlocks().find((b) => b.type === 'bio');
		expect(hero).toMatchObject({ imageKey: '' });
		expect(hero).not.toHaveProperty('headline');
		expect(bio).toMatchObject({ content: '' });
	});

	it('starts every preset block visible', () => {
		expect(presetBlocks().every((b) => !b.hidden)).toBe(true);
	});

	it('hands out a fresh array each call, so a caller cannot mutate the preset', () => {
		const a = presetBlocks();
		a[0].hidden = true;
		expect(presetBlocks()[0].hidden).toBeUndefined();
	});
});

describe('reconcileBlocks', () => {
	it('gives an empty page the whole preset', () => {
		expect(reconcileBlocks([]).map((b) => b.type)).toEqual([...PRESET_ORDER]);
	});

	it('keeps a saved block’s position and its authored fields', () => {
		const saved: Block[] = [
			{ id: 'a', type: 'contact', showForm: false },
			{ id: 'b', type: 'bio', content: 'We are a band.', cssClass: 'tight' }
		];
		const out = reconcileBlocks(saved);

		expect(out[0]).toEqual(saved[0]);
		expect(out[1]).toEqual(saved[1]);
	});

	it('appends only the missing types, in preset order', () => {
		const out = reconcileBlocks([{ id: 'a', type: 'members', showPositions: false }]);
		const appended = out.slice(1).map((b) => b.type);

		expect(out[0].type).toBe('members');
		expect(appended).toEqual(PRESET_ORDER.filter((t) => t !== 'members'));
		expect(out.filter((b) => b.type === 'members')).toHaveLength(1);
	});

	it('keeps a legacy page’s spacers and duplicates rather than pruning them', () => {
		const saved: Block[] = [
			{ id: 'a', type: 'embed', platform: 'youtube', url: 'https://y.test/1' },
			{ id: 'b', type: 'spacer', height: 'lg' },
			{ id: 'c', type: 'embed', platform: 'bandcamp', url: 'https://b.test/2' }
		];
		const out = reconcileBlocks(saved);

		expect(out.slice(0, 3)).toEqual(saved);
		expect(out.filter((b) => b.type === 'embed')).toHaveLength(2);
		expect(out.filter((b) => b.type === 'spacer')).toHaveLength(1);
	});

	it('preserves hidden preset blocks instead of re-adding them visible', () => {
		const out = reconcileBlocks([{ id: 'a', type: 'merch', items: [], hidden: true }]);
		const merch = out.filter((b) => b.type === 'merch');

		expect(merch).toHaveLength(1);
		expect(merch[0].hidden).toBe(true);
	});

	it('is idempotent', () => {
		const once = reconcileBlocks([{ id: 'a', type: 'links', style: 'icons' }]);
		expect(reconcileBlocks(once)).toEqual(once);
	});

	it('appends nothing past the block cap', () => {
		const saved: Block[] = Array.from({ length: MAX_BLOCKS }, (_, i) => ({
			id: `s${i}`,
			type: 'spacer' as const,
			height: 'sm' as const
		}));
		const out = reconcileBlocks(saved);

		expect(out).toHaveLength(MAX_BLOCKS);
		expect(out).toEqual(saved);
	});

	it('appends up to the cap and no further', () => {
		const saved: Block[] = Array.from({ length: MAX_BLOCKS - 2 }, (_, i) => ({
			id: `s${i}`,
			type: 'spacer' as const,
			height: 'sm' as const
		}));
		const out = reconcileBlocks(saved);

		expect(out).toHaveLength(MAX_BLOCKS);
		expect(out.slice(-2).map((b) => b.type)).toEqual(PRESET_ORDER.slice(0, 2));
	});

	it('does not alias the preset into its result', () => {
		const a = reconcileBlocks([]);
		const b = reconcileBlocks([]);
		expect(a[0]).not.toBe(b[0]);
	});
});
