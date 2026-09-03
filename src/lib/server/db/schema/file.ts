import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';

/**
 * A document a group holds for its own members. Phase 8 of
 * `docs/specs/groups-spec.md`.
 *
 * **A file store, not a document tool.** Members upload files produced
 * elsewhere — minutes from whatever word processor the committee already uses,
 * charts as PDFs — and download them again. There is no in-app authoring, no
 * versioning and no structured minutes format, and that boundary is what keeps
 * this small.
 *
 * Objects live in the **private** bucket (`R2_PRIVATE`), which has no custom
 * domain and no r2.dev URL. `key` must never reach `resolveImageUrl` or
 * `getPublicUrl` — see `src/lib/server/private-storage.ts`, whose whole purpose
 * is that no URL-minting function is in scope beside it.
 *
 * **Clubs and committees only.** A band's files are its rider and stage plot,
 * which already have `media` slots on the public bucket; general storage for
 * bands was dropped from this phase deliberately. The exclusion is a policy in
 * `file-service.ts` rather than a column here: the table stays plainly
 * `groupId`-keyed so that a row belonging to a band — should that policy ever
 * change, or should one arrive by another path — is still swept and purged like
 * any other.
 *
 * `groupId` cascades. That is what makes the hard-delete path in `deleteBand`
 * responsible for deleting the objects first: once the group row goes, no record
 * of these keys survives for the sweep to act on.
 */
export const file = sqliteTable(
	'file',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		/**
		 * The private R2 object key, built by `documentKey()` from the **row id**
		 * and never from the filename — two uploads named `minutes.pdf` must not
		 * collide, and the key must not be guessable from what the list displays.
		 */
		key: text('key').notNull(),
		/** The original name, sanitized at write time. Displayed, and served in `Content-Disposition`. */
		filename: text('filename').notNull(),
		/**
		 * Browser-supplied and therefore spoofable, and validated against
		 * `PRIVATE_ALLOWED_TYPES` on the way in. It is the authority for the
		 * download's `Content-Type` — the row, not what R2 happened to store.
		 */
		contentType: text('content_type').notNull(),
		/** The quota's unit. Summed per group where `deletedAt IS NULL`. */
		sizeBytes: integer('size_bytes').notNull(),
		description: text('description'),
		// Nullable and SET NULL, as `announcement.authorId` is: who uploaded it is
		// history, and the document outlives their account.
		uploadedById: text('uploaded_by_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		/**
		 * Soft delete. Removing a document detaches it and lets the sweep reclaim
		 * the object; the row is the only record of the key until then, so nothing
		 * in a write path deletes it. See `file-sweep.ts`.
		 */
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(t) => [
		// Both reads the module has, off one index: the list (`group_id = ? AND
		// deleted_at IS NULL`) and the quota's `sum(size_bytes)` over the same
		// predicate.
		index('idx_file_group').on(t.groupId, t.deletedAt),
		// A unique index rather than an inline `.unique()`: on this drizzle version
		// the column constraint silently emits nothing, and two rows naming one
		// object would let a delete of either strand or orphan the other.
		uniqueIndex('idx_file_key').on(t.key),
		// The sweep's cursor: soft-deleted rows across all groups.
		index('idx_file_deleted').on(t.deletedAt)
	]
);

export type FileRow = typeof file.$inferSelect;
