import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { contentFlag } from './flag';
import { standingScopes, standingStatuses } from '../../../config';

// The vocabularies live in $lib/config so client code can label a scope without
// importing the schema, matching suggestion.ts and volunteer.ts. Note the
// *relative* import: `$lib/config` breaks `pnpm db:generate`, because jiti has
// no alias map.

/**
 * What one upheld report, or one staff decision, costs a member — in one
 * domain.
 *
 * Replaces `community_event_standing`, `suggestion_standing` and
 * `messaging_standing`, which were the same record three times over. The key is
 * `(userId, scope)` and **not** `userId` alone: an upheld report about a gig
 * listing must not put someone on probation for suggestions. That separation is
 * the whole reason this is one table and not one column.
 *
 * **Absence of a row means good standing** — the overwhelmingly common case, and
 * the default every reader is built around.
 *
 * Every row is imposed by staff or by an upheld report. Nothing a member does to
 * their own account writes here; the one member-owned switch that used to live
 * in `messaging_standing` is `user.acceptsDirectMessages`. That is why there is
 * no `source` column: `triggeringFlagId` already says "a report caused this",
 * `updatedByUserId` already names the staffer otherwise, and a third copy of the
 * same fact is a column that can disagree with its own row.
 *
 * Lifting sets `status: 'none'` rather than deleting, so a member who was
 * restricted and later cleared still reads differently from one who never was.
 * `reason` and `triggeringFlagId` survive the lift on purpose: "why was I in
 * review?" stays answerable after forgiveness.
 */
export const memberStanding = sqliteTable(
	'member_standing',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		scope: text('scope', { enum: standingScopes }).notNull(),
		/** Which rungs are legal is per-scope; `standingScopeConfig` says, and setStanding enforces. */
		status: text('status', { enum: standingStatuses }).notNull(),
		/** The staff note, shown to the member so they know why. */
		reason: text('reason'),
		/** The report that cost them standing. Null when staff acted directly. */
		triggeringFlagId: text('triggering_flag_id').references(() => contentFlag.id, {
			onDelete: 'set null'
		}),
		updatedByUserId: text('updated_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Composite, not a surrogate id: one standing per member per scope is the
		// invariant, and it is what `onConflictDoUpdate` targets on every write.
		primaryKey({ columns: [t.userId, t.scope] }),
		index('idx_member_standing_scope_status').on(t.scope, t.status)
	]
);

export type MemberStanding = typeof memberStanding.$inferSelect;
