import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { project } from './project';
import {
	financialCategories,
	financialEntryKinds,
	financialSettlements,
	financialSubjects
} from '../../../config';

/**
 * What the collective earned, spent, and was given — append-only.
 *
 * Stripe stays authoritative for settlement; this owns accounting. Nothing here
 * mirrors a Stripe charge or tracks its lifecycle, which is the Laravel ledger
 * `finance-spec.md` deleted. Design and worked examples:
 * `docs/specs/financial-record-spec.md`.
 */
export const financialEntry = sqliteTable(
	'financial_entry',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/**
		 * Signed: positive into the collective, negative out — as
		 * `credit_transaction`. A correction is a reversing entry, never an update,
		 * so a January refund does not retroactively change November.
		 */
		amountCents: integer('amount_cents').notNull(),

		kind: text('kind', { enum: financialEntryKinds }).notNull(),
		category: text('category', { enum: financialCategories }).notNull(),

		/** When the money moved, which for a backfill is not when the row was written. */
		occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),

		settlement: text('settlement', { enum: financialSettlements }).notNull(),
		/** Present when `settlement = 'stripe'`; the key a balance cross-check joins on. */
		stripePaymentRecordId: text('stripe_payment_record_id'),

		/**
		 * The pool a `pass_through` belongs to. Read per group, because a global
		 * `sum() == 0` proves nothing — two errors cancel.
		 */
		settlementGroup: text('settlement_group'),

		/**
		 * What this is about. **No foreign key, deliberately** — following
		 * `media_attachment`: a ticket may be refunded and deleted and the
		 * financial fact still has to survive, because it is a fact about the past.
		 */
		subjectType: text('subject_type', { enum: financialSubjects }).notNull(),
		subjectId: text('subject_id').notNull(),

		/** A real FK, unlike the subject: burn reads this and must not drop rows. */
		projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),

		description: text('description').notNull(),
		/** Null for a machine-written entry, which is most of them. */
		recordedByUserId: text('recorded_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Every report is a range over `occurredAt` narrowed by one of these.
		index('idx_financial_entry_occurred').on(t.occurredAt),
		index('idx_financial_entry_kind_occurred').on(t.kind, t.occurredAt),
		index('idx_financial_entry_category_occurred').on(t.category, t.occurredAt),
		// The pool balance, and the Stripe cross-check.
		index('idx_financial_entry_group').on(t.settlementGroup),
		index('idx_financial_entry_stripe').on(t.stripePaymentRecordId),
		index('idx_financial_entry_subject').on(t.subjectType, t.subjectId),
		index('idx_financial_entry_project').on(t.projectId)
	]
);

export type FinancialEntry = typeof financialEntry.$inferSelect;
export type NewFinancialEntry = typeof financialEntry.$inferInsert;
