import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import { suggestion } from './suggestion';
import { projectStatuses } from '../../../config';

/**
 * A **project**: a body of work with a budget and an owner —
 * docs/specs/project-spec.md, and the prior art behind it in
 * docs/reports/project-management-prior-art.md.
 *
 * Not an event and not a subtype of one. Events, work orders, contractor jobs,
 * purchase orders and acquisitions each carry a nullable `projectId` pointing
 * here, which is what lets one shape serve a facility improvement (no events),
 * a produced show (one) and a festival (many). Nothing points the other way.
 *
 * **Burn is never stored beside the budget.** What a project has cost is a
 * `sum()` over the ledgers that already hold the atoms — `contractor_job`,
 * `purchase_order_line`, `acquisition`, `volunteer_hour_log` — derived on read
 * by `project-service.ts`, the way `listLateOrders` derives "late". A stored
 * total would need something to come along and keep it right.
 *
 * `status` reuses `suggestionStatuses` verbatim rather than growing its own
 * machine: a member suggests, staff commit, work orders get it done, and the
 * result shows back on the suggestion. `suggestionId` is what closes that
 * loop, and it is nullable rather than a subtype — a failed breaker panel is a
 * project nobody suggested.
 */
export const project = sqliteTable(
	'project',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		name: text('name').notNull(),
		description: text('description'),

		status: text('status', { enum: projectStatuses }).notNull().default('open'),

		/**
		 * The owning committee: a `group` with `kind = 'committee'`, enforced by
		 * the service rather than the schema (a CHECK cannot cross tables). In the
		 * first migration deliberately — committee-scoped views are what make
		 * projects usable by the people doing the work rather than another
		 * staff-only queue, and ownership is far harder to retrofit than to start
		 * with. Set-null: a disbanded committee leaves its projects unowned, not
		 * deleted.
		 */
		groupId: text('group_id').references(() => group.id, { onDelete: 'set null' }),

		/** The suggestion this answers, when a member asked for it. One project per suggestion. */
		suggestionId: text('suggestion_id').references(() => suggestion.id, { onDelete: 'set null' }),

		/** The ceiling. Null is "no budget set", not zero. */
		budgetCents: integer('budget_cents'),

		/** The baseline a project-anchored template offsets from. Both nullable: ongoing work has no end. */
		startsAt: integer('starts_at', { mode: 'timestamp' }),
		endsAt: integer('ends_at', { mode: 'timestamp' }),

		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_project_group').on(t.groupId),
		index('idx_project_status').on(t.status),
		// Partial, and in the table config rather than `.unique()` on the column:
		// a nullable `.unique()` emits no constraint at all on this drizzle, and
		// the partial form is what lets many projects have no suggestion while one
		// suggestion has at most one project.
		uniqueIndex('uq_project_suggestion')
			.on(t.suggestionId)
			.where(sql`suggestion_id is not null`),
		// `not (x < 0)` so a null budget passes rather than nulling the check —
		// the same shape as `contractor_job_cost_nonneg`.
		check('project_budget_nonneg', sql`not (budget_cents < 0)`),
		check(
			'project_ends_after_start',
			sql`starts_at is null or ends_at is null or ends_at > starts_at`
		)
	]
);

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
