import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireFeature } from '$lib/server/feature-flags';
import { requireGroupRole } from '$lib/server/group/group-context';
import { getOrCreateBandSiteId } from '$lib/server/band/band-site-service';
import { sanitizeCss } from '$lib/server/band/css-sanitizer';
import { sanitizeBio, sanitizeHtml } from '$lib/utils/markdown';
import { db } from '$lib/server/db';
import { blockSchema, type Block } from '$lib/server/db/schema/band-page';
import { bandSite } from '$lib/server/db/schema/band-site';
import { eq } from 'drizzle-orm';
import { jsonArrayField, jsonObjectField } from '$lib/utils/zod-json';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getBandPageEditor = query(z.string(), async (slug) => {
	await requireFeature('bandPremium');
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

	return {
		config: config
			? {
					theme: config.theme,
					customCss: config.customCss,
					blocks: config.blocks as Block[],
					epk: config.epk
				}
			: null
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
		theme: z.string().optional(),
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

export const saveBandEpk = form(
	z.object({
		slug: z.string().min(1),
		// JSON-encoded BandEpk. Decoded in the schema so malformed input is a field
		// issue on `epk` rather than a whole-page 400.
		epk: jsonObjectField('Invalid EPK data')
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ slug: data.slug }, 'admin');

		// Deliberately no tier check and no `requireFeature('bandPremium')`. A
		// press kit is what a band *is*, not what it buys — `band_site` holds
		// both, and `epk` is the free half of that row. What premium adds is
		// presentation and volume (video, an unbounded gallery, a themed page on
		// their own domain), never the information a venue needs to book them.
		//
		// `getOrCreateBandSiteId` rather than a bare `UPDATE … WHERE group_id`:
		// against a band whose row is somehow missing, the update matches nothing,
		// writes nothing, and still returns success — the band would be told its
		// press kit was saved when it was not.
		const siteId = await getOrCreateBandSiteId(band.id);

		await db
			.update(bandSite)
			.set({ epk: data.epk, updatedAt: new Date() })
			.where(eq(bandSite.id, siteId));

		return { success: true };
	}
);
