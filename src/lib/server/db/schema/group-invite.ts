import { sqliteTable, text, index, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group, groupRoles } from './group';

export const inviteStatuses = ['pending', 'accepted', 'revoked'] as const;
export type InviteStatus = (typeof inviteStatuses)[number];

/**
 * An invitation to a roster, addressed to an **email** rather than to an account
 * — the only case that needs a token and an expiry.
 *
 * Renamed from `platform_invite` in phase 6 of `docs/specs/groups-spec.md`. The
 * old name promised something it never was: `band_id` was NOT NULL and the role
 * was `groupRoles`, so every row was already an invitation to one roster. It was
 * never a gate on joining CMC either — signup is open, and
 * `resolvePendingInvites` matches on email alone from `hooks.server.ts`, so an
 * invitee who ignores the link and signs up unaided still lands on the roster.
 * A genuine platform-level invitation, one that other invitations hang off,
 * remains a coherent thing to want; it buys nothing while this would be its only
 * child and the parent would authorize nothing.
 *
 * **The other invite mechanism is not this table.** Inviting someone who already
 * has an account is a `group_member` row with `status = 'pending'` — that row
 * *is* the invitation, it shows on the invitee's dashboard, and accepting is a
 * status flip. Merging the two would hang nullable `token`/`email`/`expiresAt`
 * columns off every pending membership to unify flows that genuinely differ.
 */
export const groupInvite = sqliteTable(
	'group_invite',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		email: text('email').notNull(),
		token: text('token')
			.notNull()
			.unique()
			.$defaultFn(() => crypto.randomUUID()),
		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		role: text('role', { enum: groupRoles }).notNull(),
		position: text('position'),
		// Nullable, and that is the fix rather than a relaxation. The column was
		// declared `.notNull()` *and* `onDelete: 'set null'` — clauses that
		// contradict each other, so deleting a user who had ever sent an invite
		// failed on a NOT NULL violation. Who sent it is history; the invitation
		// outlives their account.
		invitedById: text('invited_by_id').references(() => user.id, { onDelete: 'set null' }),
		status: text('status', { enum: inviteStatuses }).notNull().default('pending'),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		acceptedAt: integer('accepted_at', { mode: 'timestamp' })
	},
	(t) => [
		index('idx_group_invite_email').on(t.email),
		index('idx_group_invite_group').on(t.groupId),
		// Partial, so it constrains only what "already invited" means: one live
		// invitation per address per roster, with accepted and revoked rows free to
		// accumulate. It replaces a check-then-insert in `createInvite` — a SELECT
		// for an existing pending row followed by an INSERT, which two admins
		// inviting the same person could interleave. The insert now carries an
		// `onConflictDoUpdate` that refreshes the expiry instead.
		uniqueIndex('idx_group_invite_pending')
			.on(t.groupId, t.email)
			.where(sql`status = 'pending'`)
	]
);

export type GroupInvite = typeof groupInvite.$inferSelect;
