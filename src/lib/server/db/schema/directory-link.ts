import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { directoryEntry } from './directory';
import { user } from './authentication';

/**
 * A contact-sheet link: the one URL an external act ever gets.
 *
 * There is exactly one reason an act with no CMC relationship needs a URL —
 * **so they can fill in their own details.** Staff stub an act when booking it,
 * and the act is the best source for its own bio, genres, links and booking
 * contact; asking staff to retype what an act emails them is how records go
 * stale. `contact.source` records which rows somebody actually consented to,
 * and this is the path that makes `self_entered` possible.
 *
 * It is a **write** surface, not a read one, which is why it is gated at all.
 *
 * **It creates no session and no account.** The token authorizes editing exactly
 * one entry and nothing else. It must not touch `locals.user`, and it must not
 * be confused with authentication — `platform_invite` (now `group_invite`)
 * already established this shape and this is the same pattern narrowed to one
 * row and one form. Reaching for better-auth's magic-link plugin here would add
 * a passwordless path to the real auth system to solve a data-entry problem,
 * which is a much larger change with a much larger blast radius.
 *
 * **Claiming is a different door.** This link says "keep your record current and
 * stay external"; becoming a CMC band is `claimExternalAct`. Conflating them
 * would mean an act updating its bio accidentally acquires a membership.
 */
export const directoryEntryLink = sqliteTable(
	'directory_entry_link',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		entryId: text('entry_id')
			.notNull()
			.references(() => directoryEntry.id, { onDelete: 'cascade' }),
		token: text('token')
			.notNull()
			.unique()
			.$defaultFn(() => crypto.randomUUID()),
		/**
		 * Where it was sent, and the only address it is valid for.
		 *
		 * Stored so a forwarded link is still traceable to the person CMC actually
		 * gave it to — the act's record says who was trusted with it, which is the
		 * question asked after something goes wrong.
		 */
		email: text('email').notNull(),
		/**
		 * It expires on its own, so a forwarded link does not stay live forever.
		 * Reusable until then: filling in a contact sheet is not always one sitting.
		 */
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
		/** Set the moment staff want it dead, without waiting for the expiry. */
		revokedAt: integer('revoked_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_directory_entry_link_entry').on(t.entryId),
		index('idx_directory_entry_link_expires').on(t.expiresAt)
	]
);

export type DirectoryEntryLink = typeof directoryEntryLink.$inferSelect;
