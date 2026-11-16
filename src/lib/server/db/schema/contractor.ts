import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { workOrder } from './volunteer';
import { contractorJobStatuses } from '../../../config';
import { organization } from './party';

// ---------------------------------------------------------------------------
// Contractor work
//
// Work done by somebody you pay. What the work is lives on `work_order`, the
// same task a member or volunteer could answer; a contractor's engagement on it
// is `contractor_job`. Who they are is an `organization` holding the
// `contractor` role, with a `contractor_detail` row. A labor invoice is not
// stock arriving, which is why cost lives here rather than on `acquisition`
// or `purchase_order`.
//
// See `docs/decisions/0051-contractor-work-has-its-own-tables.md` and
// `docs/decisions/0054-a-work-order-is-the-task.md`.
// ---------------------------------------------------------------------------

/**
 * One contractor's engagement on one work order, the way a `volunteer_signup`
 * is one person's place on one. The work order holds what the work is — its
 * title, the unit, the project — and owns whether the work is done; this row
 * holds who was engaged, where the engagement stands, and the money.
 *
 * Late is not a state: it is `booked` with `expected_back_at` behind us,
 * derived the way `listLateOrders` derives it.
 */
export const contractorJob = sqliteTable(
	'contractor_job',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// The contractor: an organization holding the `contractor` role, which
		// the service checks. Restrict: a completed job names who did it, and
		// deleting them would rewrite the service history the record is for.
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'restrict' }),

		status: text('status', { enum: contractorJobStatuses }).notNull().default('asked'),

		// Restrict: an engagement carries money and a ledger entry, so deleting its
		// work order must fail loudly rather than orphan the spend (set-null) or
		// erase it (cascade). Work orders are cancelled, not deleted, in every
		// service path.
		workOrderId: text('work_order_id')
			.notNull()
			.references(() => workOrder.id, { onDelete: 'restrict' }),

		/** When they come, or when the unit went out to them. */
		scheduledFor: integer('scheduled_for', { mode: 'timestamp' }),
		/** When it is promised back. Drives the overdue list; nothing else reads it. */
		expectedBackAt: integer('expected_back_at', { mode: 'timestamp' }),
		/** When the contractor finished — not when the work order was ticked. */
		completedAt: integer('completed_at', { mode: 'timestamp' }),

		/** What they said it would cost, if they said. */
		quotedCents: integer('quoted_cents'),
		/** What it actually cost. Null until the invoice arrives. */
		costCents: integer('cost_cents'),

		/**
		 * The trades half of contributed services: the electrician who comes out
		 * and does not invoice.
		 *
		 * A flag *and* a value rather than a null `cost_cents`, because
		 * "donated" and "the invoice has not arrived yet" are different states
		 * and `cost_cents` alone cannot tell them apart. A second value column
		 * rather than overloading `cost_cents` for the same reason
		 * `acquisition` keeps `total_cents` and `fair_value_cents` apart: one is
		 * money that left the account and the other is what a gift was worth,
		 * and every existing `sum(cost_cents)` would otherwise have to learn
		 * this flag — where one missed call site overstates cash spend forever.
		 *
		 * SQLite cannot add a CHECK through ALTER TABLE, so "donated implies no
		 * cost" is enforced in the service rather than the schema.
		 */
		isDonated: integer('is_donated', { mode: 'boolean' }).notNull().default(false),
		/** What the work would have cost, when it was donated. */
		fairValueCents: integer('fair_value_cents'),
		/**
		 * How that number was arrived at — a quote from another shop, the
		 * contractor's own rate card. The substantiation a financial statement
		 * wants, and the same field `acquisition.fair_value_basis` carries for
		 * donated goods.
		 */
		fairValueBasis: text('fair_value_basis'),
		/**
		 * Their invoice number. A string, not a file: the one R2 bucket is served
		 * publicly at media.corvmc.org, and an invoice with hourly rates on it has
		 * no business being addressable by key. Revisit when a private bucket
		 * exists.
		 */
		invoiceRef: text('invoice_ref'),
		/** Recorded here the way `acquisition.reimbursed_at` is — the transfer itself happens elsewhere. */
		paidAt: integer('paid_at', { mode: 'timestamp' }),

		requestedByUserId: text('requested_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		notes: text('notes'),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_contractor_job_organization').on(t.organizationId),
		index('idx_contractor_job_work_order').on(t.workOrderId),
		index('idx_contractor_job_status').on(t.status),
		// The overdue read: out with somebody, past its date. Partial so the
		// closed pile — which is most of the table forever — is never scanned.
		index('idx_contractor_job_overdue')
			.on(t.expectedBackAt)
			.where(sql`status = 'booked'`),
		// Money is never negative. Written as `not (x < 0)` so a NULL cost, which
		// is the normal state before the invoice lands, passes rather than
		// evaluating to NULL and taking the check with it.
		check('contractor_job_cost_nonneg', sql`not (cost_cents < 0) and not (quoted_cents < 0)`)
	]
);

export type ContractorJob = typeof contractorJob.$inferSelect;
