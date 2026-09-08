import type { Block } from '$lib/types/band-page';

/**
 * The block layout every premium band starts with.
 *
 * Buying premium used to hand a band an empty canvas and a picker of fourteen
 * block types to understand before anything appeared. It now hands them a page
 * that already works, which they arrange: the editor reorders and hides, and
 * nothing adds or deletes.
 *
 * That only holds together because the preset is *derived on read* rather than
 * written at upgrade time. Stamping it into the column would need a hook on
 * both the Stripe sync and the staff comp, and would still miss every band that
 * was already premium. Here, one projection covers all three, and the column is
 * only rewritten when the band saves.
 *
 * Client-safe on purpose — the page editor imports it, so it cannot live under
 * `$lib/server/`.
 */

/** The stored cap, mirrored from `blocksField` in `band-page-editor.remote.ts`. */
export const MAX_BLOCKS = 50;

/**
 * The catalogue, in the order a band page reads top to bottom.
 *
 * `spacer` is deliberately absent: it is only meaningful when you can insert one
 * at a chosen position, which reorder-and-hide does not do. Legacy pages that
 * hold one keep it — see `reconcileBlocks`.
 */
export const PRESET_ORDER = [
	'hero',
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
	'custom_html',
	'contact'
] as const satisfies readonly Block['type'][];

export type PresetBlockType = (typeof PRESET_ORDER)[number];

/** What each block is called, and what it does, for the editor's block rows. */
export const BLOCK_LABELS: Record<Block['type'], { label: string; description: string }> = {
	hero: { label: 'Hero', description: 'Full-width hero image with headline' },
	bio: { label: 'Bio', description: 'Rich text bio section' },
	links: { label: 'Links', description: 'Social and music links' },
	embed: { label: 'Embed', description: 'YouTube, Spotify, SoundCloud embed' },
	events: { label: 'Events', description: 'Upcoming shows' },
	members: { label: 'Members', description: 'Member roster' },
	gallery: { label: 'Gallery', description: 'Photo gallery grid' },
	press: { label: 'Press', description: 'Press quotes from your press kit' },
	achievements: { label: 'Achievements', description: 'Highlights from your press kit' },
	tech_rider: { label: 'Tech Rider', description: 'Stage plot and backline requirements' },
	merch: { label: 'Merch', description: 'Merchandise links' },
	custom_html: { label: 'Custom HTML', description: 'Custom HTML content (sanitized)' },
	contact: { label: 'Contact', description: 'Booking contacts and a message form' },
	spacer: { label: 'Spacer', description: 'Vertical spacing between blocks' }
};

/**
 * One preset block per type.
 *
 * Ids are stable strings rather than `crypto.randomUUID()`: the preset is
 * derived in two places (the editor query and the public site query) and they
 * have to agree, and re-deriving must not churn the `{#each}` keys under a page
 * somebody is looking at.
 *
 * Nothing here holds band content. A hero carries no headline and a bio no
 * copy — the renderer falls back to the band's own name and bio, so the preset
 * stays a constant and stays in step with the profile.
 */
function presetBlock(type: PresetBlockType): Block {
	const id = `preset:${type}`;
	switch (type) {
		case 'hero':
			return { id, type: 'hero', imageKey: '' };
		case 'bio':
			return { id, type: 'bio', content: '' };
		case 'links':
			return { id, type: 'links', style: 'buttons' };
		case 'embed':
			return { id, type: 'embed', platform: '', url: '' };
		case 'events':
			return { id, type: 'events', limit: 5 };
		case 'members':
			return { id, type: 'members', showPositions: true };
		case 'gallery':
			return { id, type: 'gallery', imageKeys: [] };
		case 'press':
			return { id, type: 'press' };
		case 'achievements':
			return { id, type: 'achievements' };
		case 'tech_rider':
			return { id, type: 'tech_rider' };
		case 'merch':
			return { id, type: 'merch', items: [] };
		case 'custom_html':
			return { id, type: 'custom_html', content: '' };
		case 'contact':
			return { id, type: 'contact', showForm: true };
	}
}

/** The full preset, freshly built — callers edit what they are handed. */
export function presetBlocks(): Block[] {
	return PRESET_ORDER.map(presetBlock);
}

/**
 * Project a stored block array into the full catalogue.
 *
 * Lossless in one direction only: everything saved keeps its position and its
 * authored fields — duplicates, spacers and all — and the types the page is
 * missing are appended in preset order. A band that built a page by hand before
 * this shipped still sees their page, with the rest of the catalogue after it;
 * they hide what they do not want rather than deleting it.
 *
 * Appends stop at `MAX_BLOCKS` so a legacy page at the cap cannot be grown into
 * a payload its own save would reject.
 */
export function reconcileBlocks(saved: Block[]): Block[] {
	const present = new Set(saved.map((block) => block.type));
	const out = [...saved];

	for (const type of PRESET_ORDER) {
		if (out.length >= MAX_BLOCKS) break;
		if (present.has(type)) continue;
		out.push(presetBlock(type));
	}

	return out;
}
