import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';
import { reservation } from './reservation';

// ---------------------------------------------------------------------------
// Finance domain types
// ---------------------------------------------------------------------------

export const creditTypes = ['free_hours', 'equipment_credits'] as const;
export type CreditType = (typeof creditTypes)[number];

export function isCreditType(value: string): value is CreditType {
	return creditTypes.includes(value as CreditType);
}

export const creditsSchema = z
	.object({
		free_hours: z.number().int().min(0).optional(),
		equipment_credits: z.number().int().min(0).optional()
	})
	.strict();

export type Credits = z.infer<typeof creditsSchema>;

export function parseCredits(raw: unknown): Credits {
	if (raw == null || (typeof raw === 'object' && Object.keys(raw as object).length === 0)) {
		return {};
	}
	return creditsSchema.parse(raw);
}

export function getBalance(credits: Credits, type: CreditType): number {
	return credits[type] ?? 0;
}

export const transactionSources = [
	'monthly_allocation',
	'checkout',
	'checkout_failed',
	'refund',
	'cancelled',
	'admin_adjustment',
	'staff_comp',
	'reservation'
] as const;

export type TransactionSource = (typeof transactionSources)[number];

export interface SubscriptionInfo {
	id: string;
	status: string;
	quantity: number;
	coveringFees: boolean;
	currentPeriodEnd: Date;
	cancelAtPeriodEnd: boolean;
}

export interface CommunityStats {
	sustainingMemberCount: number;
	totalFreeHoursAllocated: number;
	participationPercent: number;
}

// ---------------------------------------------------------------------------
// Payment record cache — mirrors Stripe Payment Records created by our app
// ---------------------------------------------------------------------------

export const paymentCache = sqliteTable(
	'payment_cache',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		reservationId: text('reservation_id').references(() => reservation.id, {
			onDelete: 'set null'
		}),
		stripeCustomerId: text('stripe_customer_id'),
		amountCents: integer('amount_cents').notNull(),
		currency: text('currency').notNull().default('usd'),
		paymentMethod: text('payment_method').notNull(),
		status: text('status').notNull().default('completed'),
		paidAt: integer('paid_at', { mode: 'timestamp' }).notNull(),
		refundedAt: integer('refunded_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_payment_record_user').on(t.userId),
		index('idx_payment_record_reservation').on(t.reservationId),
		index('idx_payment_record_paid_at').on(t.paidAt)
	]
);

// ---------------------------------------------------------------------------
// Credit transactions
// ---------------------------------------------------------------------------

export const creditTransaction = sqliteTable(
	'credit_transaction',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		creditType: text('credit_type', { enum: creditTypes }).notNull(),
		amount: integer('amount').notNull(),
		balanceAfter: integer('balance_after').notNull(),
		source: text('source', { enum: transactionSources }).notNull(),
		sourceId: text('source_id'),
		description: text('description').notNull(),
		metadata: text('metadata', { mode: 'json' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('credit_transaction_user_idx').on(t.userId),
		index('credit_transaction_user_type_idx').on(t.userId, t.creditType)
	]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type Payment = typeof paymentCache.$inferSelect;
export type CreditTransaction = typeof creditTransaction.$inferSelect;
