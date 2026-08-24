import { sqliteTable, text, integer, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Band domain types
// ---------------------------------------------------------------------------

export const bandRoles = ['owner', 'admin', 'member'] as const;
export type BandRole = (typeof bandRoles)[number];

export const bandMemberStatuses = ['pending', 'active'] as const;
export type BandMemberStatus = (typeof bandMemberStatuses)[number];

export const bandTiers = ['free', 'premium'] as const;
export type BandTier = (typeof bandTiers)[number];

export const bandSubscriptionSchema = z
	.object({
		startedAt: z.string(),
		stripeSubscriptionId: z.string(),
		billingInterval: z.enum(['monthly', 'yearly']),
		currentPeriodEnd: z.string(),
		cancelAtPeriodEnd: z.boolean().optional()
	})
	.nullable()
	.default(null);

export type BandSubscription = z.infer<typeof bandSubscriptionSchema>;

export const customDomainStatuses = ['pending', 'active', 'failed'] as const;
export type CustomDomainStatus = (typeof customDomainStatuses)[number];

/**
 * The DNS records a band must add at their registrar, straight from
 * Cloudflare's custom-hostname response. `ownership` proves they control the
 * domain; `ssl` lets Cloudflare issue the certificate. Both are TXT records, so
 * the band can verify before pointing the domain at us — no window where their
 * live site is broken.
 */
export const customDomainVerificationSchema = z
	.object({
		ownership: z.object({ name: z.string(), value: z.string() }).nullable(),
		ssl: z.object({ name: z.string(), value: z.string() }).nullable(),
		/** Where the band points the domain itself, once verified. */
		cnameTarget: z.string()
	})
	.nullable()
	.default(null);

export type CustomDomainVerification = z.infer<typeof customDomainVerificationSchema>;

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const band = sqliteTable(
	'band',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		// Deliberately NOT unique. Two bands may share a name — only the slug has
		// to be distinct, and `ensureUniqueSlug` guarantees that by suffixing.
		// The old UNIQUE here made `create()` throw a raw D1 constraint error
		// (surfaced as a 500) on any duplicate name, including one still held by a
		// soft-deleted band, since `deactivate()` only sets `deletedAt`.
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		bio: text('bio'),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'restrict' }),
		avatarKey: text('avatar_key'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' }),

		// subscription & tier
		tier: text('tier', { enum: bandTiers }).notNull().default('free'),
		subscription: text('subscription', { mode: 'json' }).$type<BandSubscription>(),

		// custom domain (premium only — every band gets {slug}.corvmc.org for free).
		// Backed by a Cloudflare for SaaS custom hostname; `customDomainHostnameId`
		// is that hostname's id, needed to poll status and to delete it.
		// Uniqueness lives in a separate index rather than a column constraint.
		// SQLite cannot add a UNIQUE column with ALTER TABLE, so `.unique()` here
		// makes drizzle rebuild the whole `band` table (create-copy-DROP-rename).
		// `pnpm db:generate` would rewrite that to be D1-safe, but a plain
		// ADD COLUMN + CREATE UNIQUE INDEX needs no rewriting at all. Same
		// semantics — SQLite implements a column UNIQUE as a unique index, and
		// both treat NULLs as distinct, so any number of bands can have none.
		customDomain: text('custom_domain'),
		customDomainStatus: text('custom_domain_status', { enum: customDomainStatuses }),
		customDomainHostnameId: text('custom_domain_hostname_id'),
		customDomainVerification: text('custom_domain_verification', {
			mode: 'json'
		}).$type<CustomDomainVerification>(),
		customDomainAddedAt: integer('custom_domain_added_at', { mode: 'timestamp' }),

		// directory profile
		tagline: text('tagline'),
		hometown: text('hometown'),
		foundedYear: text('founded_year'),
		lookingForMembers: integer('looking_for_members', { mode: 'boolean' }).notNull().default(false),
		directoryVisibility: text('directory_visibility').notNull().default('public'),
		directoryContact: text('directory_contact', { mode: 'json' }),
		links: text('links', { mode: 'json' })
	},
	(t) => [
		index('idx_band_slug').on(t.slug),
		// One band per custom domain. Also the lookup index for
		// resolveCustomDomain(), which runs on every request to a custom host.
		uniqueIndex('idx_band_custom_domain').on(t.customDomain)
	]
);

export const bandGenre = sqliteTable(
	'band_genre',
	{
		bandId: text('band_id')
			.notNull()
			.references(() => band.id, { onDelete: 'cascade' }),
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
			.references(() => band.id, { onDelete: 'cascade' }),
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
			.references(() => band.id, { onDelete: 'cascade' }),
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

export type Band = typeof band.$inferSelect;
export type BandMember = typeof bandMember.$inferSelect;
export type BandSlugHistory = typeof bandSlugHistory.$inferSelect;
