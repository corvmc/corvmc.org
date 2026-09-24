import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { grantStatuses } from '../../../config';

/**
 * A foundation, trust or agency the collective applies to.
 * See docs/specs/development-sponsors-and-grants-spec.md.
 */
export const funder = sqliteTable('funder', {
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
 * One application to a funder, and the award if it is made. Requested and
 * awarded are separate because funders routinely award less than was asked.
 * Dates are `YYYY-MM-DD` strings, a day in Corvallis with no time.
 */
export const grantApplication = sqliteTable(
	'grant_application',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		funderId: text('funder_id')
			.notNull()
			.references(() => funder.id, { onDelete: 'restrict' }),
		title: text('title').notNull(),
		status: text('status', { enum: grantStatuses }).notNull().default('prospect'),
		amountRequestedCents: integer('amount_requested_cents'),
		amountAwardedCents: integer('amount_awarded_cents'),
		applyBy: text('apply_by'),
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
		index('grant_application_funder_idx').on(t.funderId),
		index('grant_application_status_idx').on(t.status)
	]
);

/**
 * A report an award obliges: interim, final, or whatever the funder names.
 * Outstanding until `submittedOn` is set.
 */
export const grantReport = sqliteTable(
	'grant_report',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		grantApplicationId: text('grant_application_id')
			.notNull()
			.references(() => grantApplication.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		dueOn: text('due_on').notNull(),
		submittedOn: text('submitted_on'),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('grant_report_application_idx').on(t.grantApplicationId)]
);

export type Funder = typeof funder.$inferSelect;
export type NewFunder = typeof funder.$inferInsert;
export type GrantApplication = typeof grantApplication.$inferSelect;
export type NewGrantApplication = typeof grantApplication.$inferInsert;
export type GrantReport = typeof grantReport.$inferSelect;
export type NewGrantReport = typeof grantReport.$inferInsert;
