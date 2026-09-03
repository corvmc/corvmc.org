import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { inventoryAsset } from './inventory';
import { project } from './project';
import { contractorJobStatuses, contractorTrades } from '../../../config';

// ---------------------------------------------------------------------------
// Contractor work
//
// The second of the two places a broken thing gets fixed. The first is a work
// order — `work_order` with no start time, claimed by a member and paid in
// volunteer hours. This is the other: work done by somebody you pay.
//
// It is deliberately **not** folded into either of the tables it resembles:
//
// - Not `work_order`. Its `volunteer_role_id` and `capacity` are NOT NULL
//   and mean nothing here, and the design rests on unscheduled work having a
//   null `starts_at` so it falls out of every member-facing query for free. A
//   contractor's central fact is an appointment, and writing one into
//   `starts_at` would offer the electrician's slot to members, remind them
//   about it, survey them afterwards and credit them volunteer hours for work
//   an invoice already paid for.
//
// - Not `purchase_order`. `purchase_order_line.item_id` is NOT NULL against the
//   catalog, and closing an order *is* recording an acquisition — `applyReceipt`
//   takes an `acquisitionId`. A labor invoice is not stock arriving, which is
//   also why cost lives here rather than on `acquisition`.
//
// See `docs/specs/contractor-work-spec.md`.
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
 * One engagement: this contractor, this piece of work, this invoice.
 *
 * `assetId` is what splits the two cases the module serves. Set, it is a repair
 * — a particular unit goes to the shop and comes back, and the asset's own
 * ledger records the trip. Null, it is building work: an electrician has no
 * asset, and pretending otherwise would mean inventing an inventory row for the
 * breaker panel.
 *
 * The status machine is `orderStatuses`' shape for `orderStatuses`' reason:
 * `draft` is "we should call somebody", `scheduled` is "they are coming, or they
 * have it", and the two ends are terminal. Late is not a state — it is
 * `scheduled` with `expected_back_at` behind us, derived the way
 * `listLateOrders` derives it.
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

		status: text('status', { enum: contractorJobStatuses }).notNull().default('draft'),

		/** What the work is, in one line: "Retube the Bassman", "Replace panel". */
		summary: text('summary').notNull(),

		/**
		 * The unit being worked on, when there is one. Null is building work.
		 *
		 * Set-null rather than cascade, matching `stock_movement.asset_id`: what a
		 * contractor was paid for is a financial fact, and it must outlive the
		 * disposal of the amp it was spent on.
		 */
		assetId: text('asset_id').references(() => inventoryAsset.id, { onDelete: 'set null' }),

		/**
		 * The body of work this was part of. This is the column the schema was
		 * reaching for when `assetId`'s comment said "null is building work": an
		 * electrician has no asset, and now has a project instead.
		 */
		projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),

		/** When they come, or when the unit went out to them. */
		scheduledFor: integer('scheduled_for', { mode: 'timestamp' }),
		/** When it is promised back. Drives the overdue list; nothing else reads it. */
		expectedBackAt: integer('expected_back_at', { mode: 'timestamp' }),
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
		index('idx_contractor_job_asset').on(t.assetId),
		index('idx_contractor_job_project').on(t.projectId),
		index('idx_contractor_job_status').on(t.status),
		// The overdue read: out with somebody, past its date. Partial so the
		// closed pile — which is most of the table forever — is never scanned.
		index('idx_contractor_job_overdue')
			.on(t.expectedBackAt)
			.where(sql`status = 'scheduled'`),
		// Money is never negative. Written as `not (x < 0)` so a NULL cost, which
		// is the normal state before the invoice lands, passes rather than
		// evaluating to NULL and taking the check with it.
		check('contractor_job_cost_nonneg', sql`not (cost_cents < 0) and not (quoted_cents < 0)`)
	]
);

export type ContractorJob = typeof contractorJob.$inferSelect;
