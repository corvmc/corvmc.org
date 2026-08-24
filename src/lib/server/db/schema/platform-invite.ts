import { sqliteTable, text, index, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { bandRoles } from './band';
import { group } from './group';

export const inviteStatuses = ['pending', 'accepted', 'revoked'] as const;
export type InviteStatus = (typeof inviteStatuses)[number];

export const platformInvite = sqliteTable(
	'platform_invite',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		email: text('email').notNull(),
		token: text('token')
			.notNull()
			.unique()
			.$defaultFn(() => crypto.randomUUID()),
		bandId: text('band_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		role: text('role', { enum: bandRoles }).notNull(),
		position: text('position'),
		invitedById: text('invited_by_id')
			.notNull()
			.references(() => user.id, { onDelete: 'set null' }),
		status: text('status', { enum: inviteStatuses }).notNull().default('pending'),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		acceptedAt: integer('accepted_at', { mode: 'timestamp' })
	},
	(t) => [
		index('idx_platform_invite_email').on(t.email),
		index('idx_platform_invite_band').on(t.bandId)
	]
);

export type PlatformInvite = typeof platformInvite.$inferSelect;
