import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
// ---------------------------------------------------------------------------
// Profile types (shared with band.ts)
// ---------------------------------------------------------------------------

export type DirectoryVisibility = 'hidden' | 'members' | 'public';

export const subscriptionSchema = z
	.object({
		startedAt: z.string(),
		stripeSubscriptionId: z.string(),
		hoursPerReset: z.number(),
		creditsResetAt: z.string(),
		coveringFees: z.boolean().default(false),
		cancelAtPeriodEnd: z.boolean().default(false)
	})
	.nullable()
	.default(null);

export type Subscription = z.infer<typeof subscriptionSchema>;

export const directoryContactSchema = z
	.object({
		email: z.string().optional(),
		phone: z.string().optional(),
		social: z.string().optional(),
		address: z.string().optional(),
		visibility: z.string().optional()
	})
	.nullable()
	.default(null);

export type DirectoryContact = z.infer<typeof directoryContactSchema>;

export const profileLinkSchema = z.object({
	label: z.string(),
	url: z.string(),
	embed: z.boolean().optional()
});

export const profileLinksSchema = z.array(profileLinkSchema).nullable().default(null);

export type ProfileLink = z.infer<typeof profileLinkSchema>;

// ---------------------------------------------------------------------------
// better-auth core tables
// ---------------------------------------------------------------------------

export const user = sqliteTable(
	'user',
	{
		// better-auth standard fields
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull().unique(),
		emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
		image: text('image'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),

		// corvmc extensions
		pronouns: text('pronouns'),
		phone: text('phone'),
		settings: text('settings', { mode: 'json' }),
		stripeId: text('stripe_id'),
		pmType: text('pm_type'),
		pmLastFour: text('pm_last_four'),
		creditFreeHours: integer('credit_free_hours').notNull().default(0),
		creditEquipment: integer('credit_equipment').notNull().default(0),
		subscription: text('subscription', { mode: 'json' }),
		deletedAt: integer('deleted_at', { mode: 'timestamp' }),

		// Uniqueness is enforced via a unique index (below) rather than an inline
		// column constraint, so the migration is a plain ADD COLUMN + CREATE INDEX
		// and avoids a full table rebuild (which D1 can't do — it ignores
		// `PRAGMA foreign_keys=OFF` inside its migration transaction).
		memberNumber: integer('member_number'),
		/**
		 * "Members can send me a message request from the directory."
		 *
		 * A preference the member owns outright, which is why it lives here beside
		 * the other directory switches rather than in `member_standing`. Standing
		 * is a record of what staff or an upheld report did *to* someone; being
		 * reachable is the member's own call, and holding both in one row is what
		 * forced `messaging_standing` to carry a `source` column. Staff cannot set
		 * this, and turning it off never lifts a restriction.
		 */
		acceptsDirectMessages: integer('accepts_direct_messages', { mode: 'boolean' })
			.notNull()
			.default(true)
	},
	(t) => [uniqueIndex('user_member_number_unique').on(t.memberNumber)]
);

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
});

export const account = sqliteTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	/**
	 * better-auth >= 1.7 scopes account identity by issuer and matches on it
	 * during credential sign-in, so a row without one authenticates nobody — the
	 * route reports "User not found", the same message an unknown email gets.
	 *
	 * For providers with no issuer of their own better-auth synthesises one:
	 * `local:<providerId>` for local methods, `local:oauth:<providerId>` for
	 * OAuth. We are credential-only, so every row is `local:credential` — which
	 * is a constant, and therefore usable as a column default. That default is
	 * what backfills the rows that predate this column. better-auth sets the
	 * value explicitly on every account it writes; the default only covers
	 * direct inserts in seeds and fixtures.
	 */
	issuer: text('issuer').notNull().default('local:credential'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

export const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
});

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type User = typeof user.$inferSelect;
