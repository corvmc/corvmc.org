import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { grantStatuses } from '../../../config';
import { organization } from './party';

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
		/** The funder: an organization holding the `funder` role, which the service checks. */
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'restrict' }),
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
		index('grant_application_organization_idx').on(t.organizationId),
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

export type GrantApplication = typeof grantApplication.$inferSelect;
export type NewGrantApplication = typeof grantApplication.$inferInsert;
export type GrantReport = typeof grantReport.$inferSelect;
export type NewGrantReport = typeof grantReport.$inferInsert;
