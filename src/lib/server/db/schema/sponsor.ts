import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { sponsorshipStatuses } from '../../../config';
import { eventListing } from './event';
import { organization } from './party';
import { project } from './project';

/**
 * One term of support from a sponsor organization: a tier, an amount, and the
 * dates it runs, on a project of kind `sponsorship` that holds the work (#2622).
 * Dates are `YYYY-MM-DD` strings, a day in Corvallis with no time.
 */
export const sponsorship = sqliteTable(
	'sponsorship',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		/** The sponsor: an organization holding the `sponsor` role, which the service checks. */
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'restrict' }),
		/** The project this sponsorship is, as `grant_application.project_id`. */
		projectId: text('project_id').references(() => project.id, { onDelete: 'restrict' }),
		/** What the money pays for. Null is general support. */
		fundsProjectId: text('funds_project_id').references(() => project.id, {
			onDelete: 'set null'
		}),
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
	(t) => [
		index('sponsorship_organization_idx').on(t.organizationId),
		uniqueIndex('uq_sponsorship_project')
			.on(t.projectId)
			.where(sql`project_id is not null`),
		index('sponsorship_funds_project_idx').on(t.fundsProjectId)
	]
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

export type Sponsorship = typeof sponsorship.$inferSelect;
export type NewSponsorship = typeof sponsorship.$inferInsert;
export type SponsorPlacement = typeof sponsorPlacement.$inferSelect;
