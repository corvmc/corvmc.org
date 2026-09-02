import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * What a `media_attachment` can hang off. Extending this emits **zero SQL** —
 * drizzle's SQLite dialect treats a text enum as a TypeScript-only constraint —
 * which is the property that makes adding `production` or `venue` later free.
 */
export const attachableTypes = [
	'event',
	'group',
	'user',
	/** A catalog entry: manuals and spec sheets, the same for every unit of it. */
	'inventory_item',
	/** One physical unit: photographs of damage to *this* amp. */
	'inventory_asset',
	/**
	 * One report about a unit. Evidence belongs to the *observation*, not the
	 * amp: three people flag the same crackle and each photographed something
	 * different, and dismissing one report should not strand its picture.
	 */
	'asset_flag',
	/** How stock arrived: the receipt or the donation paperwork behind it. */
	'acquisition'
] as const;
export type AttachableType = (typeof attachableTypes)[number];

/**
 * Which usage an attachment represents, carrying over the `band_media.type`
 * vocabulary. Spatie calls this a collection name; ActiveStorage calls it the
 * association name. It is the same idea: one parent can hold several distinct
 * kinds of image without them being confusable.
 */
export const mediaSlots = [
	'poster',
	'avatar',
	'gallery',
	'hero',
	'rider',
	'stage_plot',
	/** Item-level documentation — a manual, a spec sheet. Usually a PDF. */
	'manual',
	/** Asset-level evidence attached to a damage report. */
	'damage',
	/** Proof of what was paid, against the acquisition that records it. */
	'receipt'
] as const;
export type MediaSlot = (typeof mediaSlots)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * One row per R2 object. Immutable in spirit: replacing an image mints a new
 * row and never mutates `key`, because the key is the only handle anything has
 * on the stored object.
 *
 * This row outliving its usages is the entire point. `event.posterKey` and
 * friends couple the object's lifetime to one entity's lifetime, which is why a
 * recurring series has to copy its poster per occurrence and why deleting a band
 * strands every gallery object it had. Here the object's lifetime is decided by
 * how many `media_attachment` rows point at it, and by nothing else.
 *
 * See docs/specs/shipped/media-spec.md.
 */
export const media = sqliteTable(
	'media',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/**
		 * The R2 object key, from `mediaKey()` — which already carries a random
		 * token, so keys are neither guessable from an entity id nor reused when an
		 * image is replaced.
		 */
		key: text('key').notNull(),

		contentType: text('content_type').notNull(),
		byteSize: integer('byte_size').notNull(),
		/** The uploader's original filename, kept for `Content-Disposition`. */
		filename: text('filename'),

		/**
		 * The two fields a bare key column had nowhere to put. Both belong to the
		 * object rather than to a usage: the same poster described twice would be
		 * two descriptions of one image.
		 */
		altText: text('alt_text'),
		caption: text('caption'),

		uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	// A unique index rather than an inline `.unique()`: on this drizzle version
	// the column constraint silently emits nothing, and one object appearing as
	// two media rows would defeat the reference counting the sweep runs on.
	(t) => [uniqueIndex('idx_media_key').on(t.key)]
);

export type Media = typeof media.$inferSelect;

/**
 * One row per usage. Many rows may point at one `media`, which is what lets 52
 * occurrences of a weekly series share a single poster object.
 *
 * **The two foreign keys are deliberately asymmetric.** `mediaId` is real and
 * cascades, so an attachment can never reference a blob that is gone.
 * `attachableId` has no foreign key at all and is reconciled by
 * `/api/cron/sweep-media`.
 *
 * That asymmetry is the design rather than an oversight. An R2 object must be
 * reaped by a sweep no matter what shape this table takes — a cascade deletes
 * rows, never objects, and on `band_media` today it deletes the only record of
 * the key and strands the object permanently. Since the sweep has to exist, the
 * integrity a parent-side foreign key would add costs more than it buys.
 *
 * Two properties make the unenforced side safe, and both were checked rather
 * than assumed. Orphans are unreachable: every read asks for one parent's media
 * by id, and a deleted parent is never asked about. And orphans can never be
 * re-adopted, because every id in this schema is a `crypto.randomUUID()`, so a
 * new row cannot inherit a dead one's id. The failure mode that makes unenforced
 * links genuinely dangerous — sequential ids being reissued — does not exist here.
 *
 * What it does cost is narrower than the spec's first draft claimed. A per-parent
 * read needs no guard, because it filters to an id its caller already holds and an
 * orphan belongs to a deleted parent. Only a **global** aggregate sees them, so
 * anything summing across parents goes through `liveAttachmentCondition()` in
 * `media-service.ts`.
 */
export const mediaAttachment = sqliteTable(
	'media_attachment',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		mediaId: text('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'cascade' }),

		attachableType: text('attachable_type', { enum: attachableTypes }).notNull(),
		/** No foreign key, by the argument above. Swept, not enforced. */
		attachableId: text('attachable_id').notNull(),

		slot: text('slot', { enum: mediaSlots }).notNull(),
		sortOrder: integer('sort_order').notNull().default(0),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// The read index. Every lookup is "this parent's media, optionally in this
		// slot", so the compound order matches the query rather than the columns.
		index('idx_media_attachment_parent').on(t.attachableType, t.attachableId, t.slot),
		// The sweep's index: reaping a media row asks whether any attachment still
		// points at it.
		index('idx_media_attachment_media').on(t.mediaId)
	]
);

export type MediaAttachment = typeof mediaAttachment.$inferSelect;
