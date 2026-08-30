import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';

/**
 * A post from a group to its own members. Phase 7 of `docs/specs/groups-spec.md`.
 *
 * One table for bands, clubs and committees alike, because a band posting to its
 * roster and a committee posting to its members are the same act — which is what
 * lets the same components mount as a band-panel page and as a tab on the club
 * page.
 *
 * Announcements are **one-way**. Replies, threads and read receipts are out of
 * scope by decision: what makes this a small feature is that the group talks to
 * its members and the members do not talk back through it.
 *
 * `groupId` is a real foreign key with `ON DELETE CASCADE`, not a polymorphic
 * `(entityType, entityId)` pair. Everything that posts is a group, so the
 * database can enforce the cleanup that `content_flag` — which has no such key —
 * still fails to do when a band is deleted.
 */
export const announcement = sqliteTable(
	'announcement',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		// Nullable and SET NULL: who wrote it is history, and the post outlives
		// their account. The same shape `group_invite.invitedById` was given in
		// phase 6, for the same reason.
		authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
		title: text('title').notNull(),
		/** Markdown. Rendered through `renderMarkdown`, which sanitizes. */
		body: text('body').notNull(),
		pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
		/**
		 * Null while a draft. Publishing stamps it and emits
		 * `announcement.published`; nothing reaches a member before it is set.
		 */
		publishedAt: integer('published_at', { mode: 'timestamp' }),
		/**
		 * The fan-out latch, written by the notification listener and never by a
		 * remote function. `UPDATE … WHERE id = ? AND notified_at IS NULL` returning
		 * no row means another invocation already sent, which is what makes the
		 * side effect idempotent under the event bus's at-least-once delivery.
		 * Not a display field.
		 */
		notifiedAt: integer('notified_at', { mode: 'timestamp' }),
		/** How many members the fan-out actually reached. Written with the latch. */
		recipientCount: integer('recipient_count'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(t) => [
		// The list query's whole shape: one group's posts, pinned first, newest
		// first. Covering `pinned` and `publishedAt` keeps it off a scan as a
		// long-running committee accumulates years of minutes.
		index('idx_announcement_group').on(t.groupId, t.pinned, t.publishedAt),
		// The fan-out cursor: unsent published rows, across all groups.
		index('idx_announcement_notified').on(t.notifiedAt)
	]
);

export type Announcement = typeof announcement.$inferSelect;
