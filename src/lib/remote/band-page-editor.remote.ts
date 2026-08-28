import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireFeature } from '$lib/server/feature-flags';
import { requireBandAdmin, requireBandMemberOrStaff } from '$lib/server/band/band-context';
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
	const { band } = await requireBandMemberOrStaff();
	if (band.slug !== slug) error(403, 'Not authorized');

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
		const { band } = await requireBandAdmin();

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
		const { band } = await requireBandAdmin();

		if (band.tier !== 'premium') {
			throw error(403, 'Premium subscription required');
		}

		const epk = data.epk;

		// Always an update — see the note on the block save above.
		await db
			.update(bandSite)
			.set({ epk, updatedAt: new Date() })
			.where(eq(bandSite.groupId, band.id));

		return { success: true };
	}
);
