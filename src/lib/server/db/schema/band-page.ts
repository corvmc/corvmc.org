import { z } from 'zod';

export {
	BAND_THEMES,
	BAND_THEME_VALUES,
	type BandTheme,
	type BandThemeValue,
	type Block,
	type MerchItem,
	type BandEpk,
	type BacklineItem,
	type PressQuote
} from '../../../types/band-page';
import type { BandSite } from './band-site';
import { BAND_THEME_VALUES } from '../../../types/band-page';

// ---------------------------------------------------------------------------
// Zod schemas for validation
// ---------------------------------------------------------------------------

/**
 * What every block carries regardless of type — the mirror of `BlockBase` in
 * `$lib/types/band-page`. `hidden` is the page editor's visibility toggle;
 * absent means visible.
 */
const blockBase = {
	id: z.string(),
	cssClass: z.string().optional(),
	hidden: z.boolean().optional()
};

export const blockSchema = z.discriminatedUnion('type', [
	z.object({
		...blockBase,
		type: z.literal('hero'),
		imageKey: z.string(),
		headline: z.string().optional(),
		subtitle: z.string().optional()
	}),
	z.object({ ...blockBase, type: z.literal('bio'), content: z.string().max(10000) }),
	z.object({
		...blockBase,
		type: z.literal('links'),
		style: z.enum(['buttons', 'icons', 'list'])
	}),
	z.object({ ...blockBase, type: z.literal('members'), showPositions: z.boolean() }),
	z.object({
		...blockBase,
		type: z.literal('events'),
		limit: z.number().optional(),
		showPast: z.boolean().optional()
	}),
	z.object({
		...blockBase,
		type: z.literal('gallery'),
		imageKeys: z.array(z.string()),
		downloadable: z.boolean().optional()
	}),
	z.object({
		...blockBase,
		type: z.literal('embed'),
		platform: z.string(),
		url: z.string().url()
	}),
	z.object({ ...blockBase, type: z.literal('press') }),
	z.object({ ...blockBase, type: z.literal('achievements') }),
	z.object({ ...blockBase, type: z.literal('contact'), showForm: z.boolean().optional() }),
	z.object({ ...blockBase, type: z.literal('tech_rider') }),
	z.object({ ...blockBase, type: z.literal('custom_html'), content: z.string().max(50000) }),
	z.object({
		...blockBase,
		type: z.literal('merch'),
		items: z
			.array(
				z.object({
					title: z.string(),
					url: z.string(),
					imageKey: z.string().optional(),
					price: z.string().optional()
				})
			)
			.max(50)
	}),
	z.object({ ...blockBase, type: z.literal('spacer'), height: z.enum(['sm', 'md', 'lg']) })
]);

export const bandPageConfigSchema = z.object({
	theme: z.enum(BAND_THEME_VALUES),
	customCss: z.string().max(51200).optional(), // 50KB
	blocks: z.array(blockSchema).max(50)
});

// ---------------------------------------------------------------------------
// Client-safe types
// ---------------------------------------------------------------------------

/** The microsite's stored shape, which lives on `band_site` since phase 3c. */
export type BandPageConfig = Pick<BandSite, 'theme' | 'customCss' | 'blocks' | 'epk'>;
