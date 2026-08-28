import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
	group,
	bandTiers,
	customDomainStatuses,
	type BandSubscription,
	type CustomDomainVerification
} from './group';

/**
 * The premium microsite: tier, its Stripe subscription, and the custom domain
 * that serves it.
 *
 * Separated from `group` because these are the things a band *buys*, not things
 * it is. Two consequences fall out of that. `groupId` is NOT NULL, so a site
 * cannot exist for an external act (phase 10) — no service-layer rule needed.
 * And `user.subscription` (membership) stops sharing a name with a band's
 * premium subscription; after this, nothing else in the schema means
 * "subscription" here.
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
