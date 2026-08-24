import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Moderation domain types
// ---------------------------------------------------------------------------

/** Why a block exists. Shown to staff for context; never to the blocked person. */
export const userBlockSources = ['manual', 'declined_request', 'reported'] as const;
export type UserBlockSource = (typeof userBlockSources)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * "I don't want to hear from this person."
 *
 * Rows point one way, but every check looks both ways — so one row is enough,
 * and two (both parties blocking) change nothing. Unblocking deletes the row:
 * unlike `member_standing` this is a live preference rather than a staff
 * decision, so there is no history worth preserving.
 *
 * Blocking is enforced on send, reply and accept. It is deliberately NOT
 * enforced on reads — the person who blocked still needs the conversation in
 * order to report it.
 */
export const userBlock = sqliteTable(
	'user_block',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		blockerUserId: text('blocker_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		blockedUserId: text('blocked_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		source: text('source', { enum: userBlockSources }).notNull().default('manual'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('uq_user_block_pair').on(t.blockerUserId, t.blockedUserId),
		index('idx_user_block_blocked').on(t.blockedUserId)
	]
);

export type UserBlock = typeof userBlock.$inferSelect;
