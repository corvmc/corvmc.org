import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { sponsorshipStatuses } from '../../../config';

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

export type Sponsor = typeof sponsor.$inferSelect;
export type NewSponsor = typeof sponsor.$inferInsert;
export type Sponsorship = typeof sponsorship.$inferSelect;
export type NewSponsorship = typeof sponsorship.$inferInsert;
