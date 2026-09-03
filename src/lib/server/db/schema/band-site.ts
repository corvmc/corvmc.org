import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { group } from './group';
import type { Block, BandEpk } from '../../../types/band-page';

// ---------------------------------------------------------------------------
// Tier and custom-domain vocabularies
// ---------------------------------------------------------------------------
// They lived in `group.ts` while the columns did. Phase 3c moved both here, so
// a vocabulary sits beside the column it constrains again.

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
 * A band's public presence: what it bought, and what it wrote.
 *
 * **Read the column list before concluding this table is premium.** It was
 * originally all one thing — the things a band *buys* rather than things it is —
 * and `epk` no longer belongs to that half. Every band has a press kit, free, so
 * the row now splits two ways:
 *
 * | Bought                                                        | Not bought |
 * | ------------------------------------------------------------- | ---------- |
 * | `tier`, `subscription`, `customDomain*`, `theme`, `customCss`, `blocks` | `epk` |
 *
 * That the free half sits in a table named `band_site` is a naming debt, not a
 * gate. It stays here rather than moving because the row already has exactly the
 * property the free half needs — one per band, created with the band, never
 * deleted while it lives — so a read needs no fallback and a move would buy
 * nothing but a migration. Which audience each half of `epk` is for is decided
 * in `$lib/server/band/press-kit.ts`, not here.
 *
 * Separated from `group` because of the bought half. Two consequences fall out
 * of that. `groupId` is NOT NULL, so a site cannot exist for an external act
 * (phase 10) — no service-layer rule needed. And `user.subscription`
 * (membership) stops sharing a name with a band's premium subscription; after
 * this, nothing else in the schema means "subscription" here.
 *
 * **One row per band, created with the band, and never deleted while the band
 * lives.** `band_page_config` and `band_media` cascade from this row, so
 * deleting it on a cancelled subscription would destroy the blocks, theme,
 * custom CSS, EPK and every uploaded image the band built — content a lapsed
 * card must not be able to take with it. Downgrading sets `tier` back to
 * `'free'` and nulls `subscription`, exactly as it does today; the site content
 * sits dormant and returns intact if they resubscribe.
 *
 * That is also why `tier` lives here rather than staying on `group`: every band
 * has a tier, this row always exists, and reading it needs no fallback.
 *
 * Vocabularies still live in `group.ts` alongside the columns they describe;
 * they move here in the phase that drops those columns. See
 * docs/specs/groups-spec.md.
 */
export const bandSite = sqliteTable(
	'band_site',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),

		tier: text('tier', { enum: bandTiers }).notNull().default('free'),
		subscription: text('subscription', { mode: 'json' }).$type<BandSubscription>(),

		// Premium only, and backed by a Cloudflare for SaaS custom hostname.
		// `customDomainHostnameId` is that hostname's id, needed to poll status and
		// to delete it.
		customDomain: text('custom_domain'),
		customDomainStatus: text('custom_domain_status', { enum: customDomainStatuses }),
		customDomainHostnameId: text('custom_domain_hostname_id'),
		customDomainVerification: text('custom_domain_verification', {
			mode: 'json'
		}).$type<CustomDomainVerification>(),
		customDomainAddedAt: integer('custom_domain_added_at', { mode: 'timestamp' }),

		// ---------------------------------------------------------------------
		// The microsite itself
		// ---------------------------------------------------------------------
		// These were `band_page_config`, a second table keyed one-to-one to this
		// one and cascading from it — the same row split in two. Phase 3c folded
		// it in: one row per band's site, one cascade, and no upsert branch on the
		// page editor deciding whether a config exists yet.
		//
		// They are bulk (`customCss` caps at 50KB, `blocks` at 50 entries) and this
		// row is read from `reroute` on every request to a custom host. That is
		// affordable because SQLite reads only the columns a query names and large
		// TEXT overflows to pages a `tier`/`custom_domain_status` lookup never
		// touches — but it is the reason to keep `resolveCustomDomain`'s select
		// narrow rather than splatting the row.
		theme: text('theme').notNull().default('default'),
		customCss: text('custom_css'),
		blocks: text('blocks', { mode: 'json' }).$type<Block[]>().notNull().default([]),
		// The free half of this row. Two audiences are mixed in here — the
		// marketing a stranger may read, and the advance material only a venue the
		// band emailed should see — so nothing reads this column raw:
		// `publicPressKit()` / `fullPressKit()` in `$lib/server/band/press-kit.ts`
		// are the only ways out of it.
		epk: text('epk', { mode: 'json' }).$type<BandEpk>(),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	// Unique indexes rather than inline `.unique()`: this drizzle version emits
	// nothing at all for a column-level unique on a nullable column, which cost a
	// missing constraint in phase 3a and was caught only by reading the generated
	// SQL. `custom_domain` is nullable, and SQLite treats NULLs as distinct, so
	// any number of bands can have none.
	(t) => [
		uniqueIndex('idx_band_site_group').on(t.groupId),
		uniqueIndex('idx_band_site_custom_domain').on(t.customDomain),
		// `resolveBandSubdomain` joins on this from a hot path.
		index('idx_band_site_tier').on(t.tier)
	]
);

export type BandSite = typeof bandSite.$inferSelect;
