import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { workOrder } from './volunteer';
import { contractorJobStatuses, contractorTrades } from '../../../config';

// ---------------------------------------------------------------------------
// Contractor work
//
// Work done by somebody you pay. What the work is lives on `work_order`, the
// same task a member or volunteer could answer; a contractor's engagement on it
// is `contractor_job`. A labor invoice is not stock arriving, which is why cost
// lives here rather than on `acquisition` or `purchase_order`.
//
// See `docs/specs/shipped/contractor-work-spec.md` and
// `docs/specs/shipped/work-orders-as-tasks-spec.md`.
// ---------------------------------------------------------------------------

/**
 * Somebody the collective pays to do work: an instrument tech, an electrician,
 * the company that services the extinguishers.
 *
 * This is the entity `docs/specs/inventory-spec.md` deferred — "revisit when
 * free text actually fragments, or when one of those features forces the entity
 * into being." Servicing forces it: `purchase_order.supplier_name` can stay free
 * text because you never have to *phone* a receipt, and "who serviced the
 * building and when" is unanswerable without a row to hang a history off.
 *
 * It is still not the `supplier` table that spec declined, and the two should
 * not be merged on the strength of the word alone. A supplier sells goods that
 * arrive and enter stock; a contractor performs work that leaves no stock
 * behind. That the same shop may one day be both is a consolidation to make
 * deliberately, not to pre-empt.
 */
export const contractor = sqliteTable(
	'contractor',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		name: text('name').notNull(),
		trade: text('trade', { enum: contractorTrades }).notNull(),

		/** The person you actually ask for. Often not whoever answers the phone. */
		contactName: text('contact_name'),
		phone: text('phone'),
		email: text('email'),
		website: text('website'),

		licenseNumber: text('license_number'),

		/**
		 * When their certificate of insurance runs out.
		 *
		 * A bare date and **no status column**, following `member_certification`:
		 * current, expiring soon and lapsed are three readings of one date, and a
		 * stored status is a fourth thing that has to be kept true by something.
		 * Null means we hold no certificate — which is not the same as current,
		 * and the UI must not render it as if it were.
		 */
		insuranceExpiresAt: integer('insurance_expires_at', { mode: 'timestamp' }),

		notes: text('notes'),

		/**
		 * Retired rather than deleted. A contractor with jobs against them is
		 * history, and `contractor_job.contractor_id` restricts deletion anyway —
		 * this is the way to get someone out of the pickers without lying about
		 * who fixed the amp in 2024.
		 */
		archivedAt: integer('archived_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_contractor_trade').on(t.trade),
		// The picker's read: everyone still in service, in name order.
		index('idx_contractor_active')
			.on(t.name)
			.where(sql`archived_at is null`),
		// The renewal read: who is lapsing, soonest first.
		index('idx_contractor_insurance')
			.on(t.insuranceExpiresAt)
			.where(sql`archived_at is null`)
	]
);

export type Contractor = typeof contractor.$inferSelect;

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

		// Restrict: a completed job names who did it, and deleting the contractor
		// out from under it would rewrite the service history that is the whole
		// point of keeping the record.
		contractorId: text('contractor_id')
			.notNull()
			.references(() => contractor.id, { onDelete: 'restrict' }),

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
		index('idx_contractor_job_contractor').on(t.contractorId),
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
