import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { sponsorshipStatuses } from '../../../config';
import { eventListing } from './event';

/**
 * A business that sponsors, or might sponsor, the collective. The row outlives
 * any one term, so its history and its contact stay in one place.
 * See docs/specs/shipped/development-agreements-spec.md.
 */
export const sponsor = sqliteTable('sponsor', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	website: text('website'),
	contactName: text('contact_name'),
	contactEmail: text('contact_email'),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

/**
 * One term of support from a sponsor: a tier, an amount, and the dates it runs.
 * Dates are `YYYY-MM-DD` strings, a day in Corvallis with no time.
 */
export const sponsorship = sqliteTable(
	'sponsorship',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sponsorId: text('sponsor_id')
			.notNull()
			.references(() => sponsor.id, { onDelete: 'restrict' }),
		title: text('title').notNull(),
		tier: text('tier'),
		status: text('status', { enum: sponsorshipStatuses }).notNull().default('prospect'),
		amountCents: integer('amount_cents'),
		startsOn: text('starts_on'),
		endsOn: text('ends_on'),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('sponsorship_sponsor_idx').on(t.sponsorId)]
);

/**
 * A sponsorship credited on one event (#583): on its public page, in the blasts
 * about it, or both. Only an active or finished term is ever shown; a pitch can
 * be placed ahead of signing and stays invisible until it is active.
 */
export const sponsorPlacement = sqliteTable(
	'sponsor_placement',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sponsorshipId: text('sponsorship_id')
			.notNull()
			.references(() => sponsorship.id, { onDelete: 'cascade' }),
		eventId: text('event_id')
			.notNull()
			.references(() => eventListing.id, { onDelete: 'cascade' }),
		onEventPage: integer('on_event_page', { mode: 'boolean' }).notNull().default(true),
		inCampaign: integer('in_campaign', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('sponsor_placement_term_event_idx').on(t.sponsorshipId, t.eventId),
		index('sponsor_placement_event_idx').on(t.eventId)
	]
);

export type Sponsor = typeof sponsor.$inferSelect;
export type NewSponsor = typeof sponsor.$inferInsert;
export type Sponsorship = typeof sponsorship.$inferSelect;
export type NewSponsorship = typeof sponsorship.$inferInsert;
export type SponsorPlacement = typeof sponsorPlacement.$inferSelect;
