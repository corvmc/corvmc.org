import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { grantStatuses } from '../../../config';
import { organization } from './party';
import { project } from './project';

/**
 * One application to a funder, and the award if it is made: the funding facts
 * on a project of kind `grant`, which holds the work (#2622). Its reports are
 * that project's tasks. Requested and awarded are separate because funders
 * routinely award less than was asked. Dates are `YYYY-MM-DD` strings, a day
 * in Corvallis with no time.
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
		/**
		 * The project this application is (`project.kind = 'grant'`), written in
		 * the same batch. Nullable like `production.project_id`, so adding it
		 * needed no rebuild; the service always sets it.
		 */
		projectId: text('project_id').references(() => project.id, { onDelete: 'restrict' }),
		/** What the award pays for. Null is general operating support. */
		fundsProjectId: text('funds_project_id').references(() => project.id, {
			onDelete: 'set null'
		}),
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
		index('grant_application_status_idx').on(t.status),
		uniqueIndex('uq_grant_application_project')
			.on(t.projectId)
			.where(sql`project_id is not null`),
		index('grant_application_funds_project_idx').on(t.fundsProjectId)
	]
);

export type GrantApplication = typeof grantApplication.$inferSelect;
export type NewGrantApplication = typeof grantApplication.$inferInsert;
