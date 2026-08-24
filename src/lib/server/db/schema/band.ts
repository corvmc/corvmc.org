import { sqliteTable, text, integer, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';

// ---------------------------------------------------------------------------
// Band domain types
// ---------------------------------------------------------------------------

export const bandRoles = ['owner', 'admin', 'member'] as const;
export type BandRole = (typeof bandRoles)[number];

export const bandMemberStatuses = ['pending', 'active'] as const;
export type BandMemberStatus = (typeof bandMemberStatuses)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const bandGenre = sqliteTable(
	'band_genre',
	{
		bandId: text('band_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		genre: text('genre').notNull()
	},
	(t) => [index('idx_band_genre_band').on(t.bandId)]
);

/**
 * Addresses a band has released by changing its slug. An old slug redirects to
 * the band's current address only for as long as no *current* band holds it —
 * a live `band.slug` always wins, and claiming a released slug deletes its
 * history row (see `changeBandSlug`). That deletion is also why at most one row
 * can exist per slug, hence the unique index rather than a plain one.
 *
 * `onDelete: 'cascade'` is load-bearing, not decorative: `deleteBand` hard
 * deletes the band row, so without it every deletion of a band that ever
 * changed its address would fail on the foreign key.
 */
export const bandSlugHistory = sqliteTable(
	'band_slug_history',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		slug: text('slug').notNull(),
		bandId: text('band_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Doubles as the lookup index for the old-slug redirect, which runs on
		// every unresolved band subdomain and directory 404.
		uniqueIndex('idx_band_slug_history_slug').on(t.slug),
		index('idx_band_slug_history_band').on(t.bandId)
	]
);

export const bandMember = sqliteTable(
	'band_member',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		bandId: text('band_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role', { enum: bandRoles }).notNull(),
		/** Instrument or job in this band — "Bass", "Vocals". The band's word for the role. */
		position: text('position'),
		/**
		 * A per-band stage name. Distinct from `user.name`, which is one identity
		 * across the whole platform, and from `event_band.name`, which is an act on
		 * a bill rather than a person. Null means "use the account name" — the
		 * roster falls back rather than storing a copy that goes stale the moment
		 * someone renames their account.
		 *
		 * Self-set only. An admin can say what you play; they cannot rename you.
		 */
		alias: text('alias'),
		status: text('status', { enum: bandMemberStatuses }).notNull(),
		invitedById: text('invited_by_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		unique('band_member_band_user_unique').on(t.bandId, t.userId),
		index('idx_band_member_user').on(t.userId),
		index('idx_band_member_status').on(t.status),
		// Ownership is stored twice — here and on `band.ownerId` — and only
		// `create()` writes both in one batch. This caps a band at one owner row
		// so the second drift path (a `transferOwnership` whose demote matched
		// nothing) can't silently produce two. It cannot enforce that a band has
		// *at least* one owner, nor that the row agrees with `band.ownerId`:
		// SQLite has no cross-table constraint. Both stay code-level. See CHORES.
		uniqueIndex('idx_band_member_single_owner')
			.on(t.bandId)
			.where(sql`role = 'owner'`)
	]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type BandMember = typeof bandMember.$inferSelect;
export type BandSlugHistory = typeof bandSlugHistory.$inferSelect;
