import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import {
	classifiedKinds,
	classifiedCategories,
	classifiedStatuses,
	classifiedVisibilities,
	classifiedTagKinds
} from '../../../config';

// Relative config import: `$lib/config` breaks `pnpm db:generate` (jiti has no alias map).

/**
 * A member's wanted or offered post. On the board means open, visible and
 * unexpired. Expiry is compared at read time and never stored as a status.
 *
 * `visibility` is the moderation axis, as on `suggestion`: enforcement moves it
 * and never deletes the row, so a takedown made in error is fully restorable.
 */
export const classifiedPost = sqliteTable(
	'classified_post',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		authorUserId: text('author_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Posted as this band. The author must be its owner or an admin when posting. */
		groupId: text('group_id').references(() => group.id, { onDelete: 'set null' }),
		kind: text('kind', { enum: classifiedKinds }).notNull(),
		category: text('category', { enum: classifiedCategories }).notNull(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		status: text('status', { enum: classifiedStatuses }).notNull().default('open'),
		visibility: text('visibility', { enum: classifiedVisibilities }).notNull().default('visible'),
		/** Staff's reason, shown to the author. */
		visibilityNote: text('visibility_note'),
		visibilityChangedAt: integer('visibility_changed_at', { mode: 'timestamp' }),
		visibilityChangedByUserId: text('visibility_changed_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		closedAt: integer('closed_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('classified_post_board_idx').on(t.status, t.visibility, t.expiresAt),
		index('classified_post_author_idx').on(t.authorUserId),
		index('classified_post_group_idx').on(t.groupId)
	]
);

export type ClassifiedPost = typeof classifiedPost.$inferSelect;

/** Values are normalised as `directory_tag`'s are, so a post tag and a profile tag compare equal. */
export const classifiedPostTag = sqliteTable(
	'classified_post_tag',
	{
		postId: text('post_id')
			.notNull()
			.references(() => classifiedPost.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: classifiedTagKinds }).notNull(),
		value: text('value').notNull()
	},
	(t) => [
		unique('classified_post_tag_post_kind_value_unique').on(t.postId, t.kind, t.value),
		index('idx_classified_post_tag_kind_value').on(t.kind, t.value)
	]
);

export type ClassifiedPostTag = typeof classifiedPostTag.$inferSelect;
