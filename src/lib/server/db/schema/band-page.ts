import { z } from 'zod';

export {
	BAND_THEMES,
	type BandTheme,
	type Block,
	type MerchItem,
	type BandEpk,
	type BacklineItem,
	type PressQuote
} from '../../../types/band-page';
import type { BandSite } from './band-site';
import { BAND_THEMES } from '../../../types/band-page';

// ---------------------------------------------------------------------------
// Zod schemas for validation
// ---------------------------------------------------------------------------

export const blockSchema = z.discriminatedUnion('type', [
	z.object({
		id: z.string(),
		type: z.literal('hero'),
		imageKey: z.string(),
		headline: z.string().optional(),
		subtitle: z.string().optional(),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
		type: z.literal('bio'),
		content: z.string().max(10000),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
		type: z.literal('links'),
		style: z.enum(['buttons', 'icons', 'list']),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
		type: z.literal('members'),
		showPositions: z.boolean(),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
		type: z.literal('events'),
		limit: z.number().optional(),
		showPast: z.boolean().optional(),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
		type: z.literal('gallery'),
		imageKeys: z.array(z.string()),
		downloadable: z.boolean().optional(),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
		type: z.literal('embed'),
		platform: z.string(),
		url: z.string().url(),
		cssClass: z.string().optional()
	}),
	z.object({ id: z.string(), type: z.literal('press'), cssClass: z.string().optional() }),
	z.object({ id: z.string(), type: z.literal('achievements'), cssClass: z.string().optional() }),
	z.object({
		id: z.string(),
		type: z.literal('contact'),
		showForm: z.boolean().optional(),
		cssClass: z.string().optional()
	}),
	z.object({ id: z.string(), type: z.literal('tech_rider'), cssClass: z.string().optional() }),
	z.object({
		id: z.string(),
		type: z.literal('custom_html'),
		content: z.string().max(50000),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
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
			.max(50),
		cssClass: z.string().optional()
	}),
	z.object({
		id: z.string(),
		type: z.literal('spacer'),
		height: z.enum(['sm', 'md', 'lg']),
		cssClass: z.string().optional()
	})
]);

export const bandPageConfigSchema = z.object({
	theme: z.enum(BAND_THEMES),
	customCss: z.string().max(51200).optional(), // 50KB
	blocks: z.array(blockSchema).max(50)
});

// ---------------------------------------------------------------------------
// Client-safe types
// ---------------------------------------------------------------------------

/** The microsite's stored shape, which lives on `band_site` since phase 3c. */
export type BandPageConfig = Pick<BandSite, 'theme' | 'customCss' | 'blocks' | 'epk'>;
