import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { group } from './group';

export {
	BAND_THEMES,
	type BandTheme,
	type Block,
	type MerchItem,
	type BandEpk,
	type BacklineItem,
	type PressQuote
} from '../../../types/band-page';
import type { Block, BandEpk } from '../../../types/band-page';
import { BAND_THEMES } from '../../../types/band-page';

// ---------------------------------------------------------------------------
// Band Page Config — stores block layout, theme, and custom CSS for premium pages
// ---------------------------------------------------------------------------

export const bandPageConfig = sqliteTable(
	'band_page_config',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		bandId: text('band_id')
			.notNull()
			.unique()
			.references(() => group.id, { onDelete: 'cascade' }),
		theme: text('theme').notNull().default('default'),
		customCss: text('custom_css'),
		blocks: text('blocks', { mode: 'json' }).$type<Block[]>().notNull().default([]),
		epk: text('epk', { mode: 'json' }).$type<BandEpk>(),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_band_page_config_band').on(t.bandId)]
);

// ---------------------------------------------------------------------------
// Band Media — R2-stored images for gallery, hero, etc.
// ---------------------------------------------------------------------------

export const bandMedia = sqliteTable(
	'band_media',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		bandId: text('band_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		type: text('type').notNull(), // 'image' | 'hero' | 'rider' | 'stage_plot'
		caption: text('caption'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_band_media_band_type').on(t.bandId, t.type, t.sortOrder)]
);

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

export type BandPageConfig = typeof bandPageConfig.$inferSelect;
export type BandMedia = typeof bandMedia.$inferSelect;
