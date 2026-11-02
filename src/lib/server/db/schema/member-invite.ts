import { sqliteTable, text, index, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { inviteStatuses } from './group-invite';

/**
 * An invitation to join CMC itself, addressed to an email with no account.
 * Signup stays open, so this authorizes nothing: it is the record staff list,
 * resend and revoke, and the one a member's daily invite cap counts. Sign-in
 * resolves it by email, as `resolvePendingInvites` does for `group_invite`.
 * `groupIds` are the clubs and committees whose `group_invite` rows were
 * created alongside it, so a revoke or resend can reach them.
 */
export const memberInvite = sqliteTable(
	'member_invite',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		email: text('email').notNull(),
		name: text('name'),
		groupIds: text('group_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
		invitedById: text('invited_by_id').references(() => user.id, { onDelete: 'set null' }),
		status: text('status', { enum: inviteStatuses }).notNull().default('pending'),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		sentAt: integer('sent_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		acceptedById: text('accepted_by_id').references(() => user.id, { onDelete: 'set null' }),
		acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
		revokedById: text('revoked_by_id').references(() => user.id, { onDelete: 'set null' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp' })
	},
	(t) => [
		// One live invitation per address; accepted and revoked rows accumulate.
		uniqueIndex('idx_member_invite_pending')
			.on(t.email)
			.where(sql`status = 'pending'`),
		index('idx_member_invite_inviter_sent').on(t.invitedById, t.sentAt)
	]
);

export type MemberInvite = typeof memberInvite.$inferSelect;
