import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { z } from 'zod';
import { groupKinds, groupJoinPolicies } from '../../../config';

// ---------------------------------------------------------------------------
// Tier and custom-domain vocabularies
// ---------------------------------------------------------------------------
// These describe columns on `group`, so they live beside it. `band.ts` keeps the
// roster vocabularies (`bandRoles`, `bandMemberStatuses`) that describe its own.

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

/**
 * A set of CMC members who organise together — a band, a club, or a committee.
 *
 * This is the `band` table renamed, not a new one: `group.id` is `band.id`, so
 * every foreign key that pointed at a band still points at the same row. That is
 * what keeps the rest of the migration cheap — six child tables change the name
 * they reference and nothing else, and no band→group id map has to be threaded
 * through the phases that follow.
 *
 * Columns that belong elsewhere are still here and move out later: the listing
 * fields (`tagline`, `hometown`, `links`, `directoryVisibility`, …) go to
 * `directory_entry`, and the premium ones (`tier`, `subscription`, the
 * `customDomain*` set) go to `band_site`. See docs/specs/groups-spec.md.
 */
export const group = sqliteTable(
	'group',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/**
		 * Governance only — see `groupKinds`. Every existing row is a `band`, which
		 * is why that is the default: the rename has to leave twelve live bands
		 * exactly as they were.
		 */
		kind: text('kind', { enum: groupKinds }).notNull().default('band'),

		// Deliberately NOT unique. Two groups may share a name — only the slug has
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

		/** How the roster is joined — see `groupJoinPolicies`. Nothing reads it until the group panel lands. */
		joinPolicy: text('join_policy', { enum: groupJoinPolicies }).notNull().default('invite_only'),
		/** Prose shown beside the Join button: "third Thursday, bring a horn, charts provided". */
		joinInstructions: text('join_instructions'),

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
		// makes drizzle rebuild the whole table (create-copy-DROP-rename).
		// `pnpm db:generate` would rewrite that to be D1-safe, but a plain
		// ADD COLUMN + CREATE UNIQUE INDEX needs no rewriting at all. Same
		// semantics — SQLite implements a column UNIQUE as a unique index, and
		// both treat NULLs as distinct, so any number of groups can have none.
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
	// Index names keep their `band` prefix on purpose. SQLite carries indexes
	// through a table rename untouched, so renaming them here would turn a free
	// rename into a drop-and-recreate for no behavioural gain. They can be
	// renamed later in a migration that has a reason to touch them.
	(t) => [
		index('idx_band_slug').on(t.slug),
		// One group per custom domain. Also the lookup index for
		// resolveCustomDomain(), which runs on every request to a custom host.
		uniqueIndex('idx_band_custom_domain').on(t.customDomain)
	]
);

export type Group = typeof group.$inferSelect;
