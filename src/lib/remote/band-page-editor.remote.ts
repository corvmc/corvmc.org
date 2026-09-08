import { z } from 'zod';
import { jsonArrayField } from '$lib/utils/zod-json';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireGroupRole } from '$lib/server/group/group-context';
import { sanitizeCss } from '$lib/server/band/css-sanitizer';
import { sanitizeBio, sanitizeHtml } from '$lib/utils/markdown';
import { db } from '$lib/server/db';
import { blockSchema, BAND_THEME_VALUES, type Block } from '$lib/server/db/schema/band-page';
import { bandSite } from '$lib/server/db/schema/band-site';
import { reconcileBlocks } from '$lib/utils/band-site-preset';
import { loadBandSiteContent, blockImageUrls } from '$lib/server/band/band-site-content';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getBandPageEditor = query(z.string(), async (slug) => {
	// `requireUser()` alone served any premium band's theme, custom CSS, blocks
	// and — the part that actually matters — its `epk`, the band's private press
	// kit, to any signed-in account that knew a slug. The blocks are semi-public
	// (the microsite renders them); the EPK never was.
	//
	// The `band.slug !== slug` cross-check this used to carry is gone with the
	// two sources of truth that made it necessary: the guard resolves the group
	// from this argument, so there is no second slug for it to disagree with.
	const { group: band } = await requireGroupRole({ slug }, 'member', { allowStaff: true });

	// The microsite's content lives on `band_site` since phase 3c; the row always
	// exists, so there is nothing to create here.
	const [config] = await db.select().from(bandSite).where(eq(bandSite.groupId, band.id)).limit(1);

	// The editor opens on the full catalogue rather than an empty canvas. The
	// preset is projected here rather than written at upgrade time — see
	// `$lib/utils/band-site-preset` for why — so the column only gains it when
	// the band saves.
	const blocks = reconcileBlocks((config?.blocks ?? []) as Block[]);

	// The editor renders the real page now, not a swatch of it, so it loads what
	// the public page loads. Without this every derived block reports itself
	// empty and a band with a full gig list is told to go add a show.
	const content = await loadBandSiteContent(band);

	return {
		config: config
			? {
					theme: config.theme,
					customCss: config.customCss,
					blocks,
					epk: config.epk
				}
			: null,
		// Blocks stay raw here — they are what gets saved, and writing a resolved
		// URL back into `imageKey` would corrupt the row. The client substitutes
		// at render time from this map.
		imageUrls: blockImageUrls(blocks),
		band: content.band,
		members: content.members,
		events: content.events,
		pastEvents: content.pastEvents,
		media: content.media
	};
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * JSON-encoded blocks array. Decoding + block validation happen in the schema so
 * a malformed payload surfaces as a field issue on `blocks` instead of a
 * whole-page 400 (and never as the 500 a bare `JSON.parse` transform throws).
 * `''` means "not provided", matching the previous `if (data.blocks)` guard —
 * `'[]'` still means "the user deleted every block".
 */
const blocksField = z
	.union([
		z.literal('').transform(() => undefined),
		jsonArrayField(blockSchema, 'Invalid blocks configuration').refine(
			(blocks) => blocks.length <= 50,
			'A page can have at most 50 blocks'
		)
	])
	.optional();

export const saveBandPageConfig = form(
	z.object({
		slug: z.string().min(1),
		// The value becomes a class name on the public container, so it is the
		// theme list plus `custom` — not any string a client cares to post.
		theme: z.enum(BAND_THEME_VALUES).optional(),
		customCss: z.string().max(51200).optional(),
		blocks: blocksField
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ slug: data.slug }, 'admin');

		if (band.tier !== 'premium') {
			throw error(403, 'Premium subscription required');
		}

		// Sanitize user-authored HTML at rest (the renderer sanitizes again on read)
		const blocks: Block[] | undefined = data.blocks?.map((block) => {
			if (block.type === 'bio') return { ...block, content: sanitizeBio(block.content) };
			if (block.type === 'custom_html') return { ...block, content: sanitizeHtml(block.content) };
			return block;
		});

		// Sanitize custom CSS if provided
		let customCss: string | null | undefined = undefined;
		if (data.customCss !== undefined) {
			const { css } = sanitizeCss(data.customCss);
			customCss = css || null;
		}

		// No upsert branch any more: the site row is created with the band, so
		// this is always an update. That branch existed only because
		// `band_page_config` was a second row that might not have been made yet.
		const updates: Record<string, unknown> = { updatedAt: new Date() };
		if (data.theme !== undefined) updates.theme = data.theme;
		if (customCss !== undefined) updates.customCss = customCss;
		if (blocks !== undefined) updates.blocks = blocks;

		await db.update(bandSite).set(updates).where(eq(bandSite.groupId, band.id));

		return { success: true };
	}
);
