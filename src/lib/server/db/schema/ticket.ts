import { sqliteTable, text, index, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { event } from './event';

export const ticketStatuses = ['pending', 'valid', 'checked_in', 'cancelled'] as const;
export type TicketStatus = (typeof ticketStatuses)[number];

export const ticket = sqliteTable(
	'ticket',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		purchaseId: text('purchase_id').notNull(),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		attendeeName: text('attendee_name').notNull(),
		attendeeEmail: text('attendee_email').notNull(),
		code: text('code').notNull().unique(),
		status: text('status', { enum: ticketStatuses }).notNull().default('pending'),
		// Proof of payment, per finance-spec: the purchasable stores the Stripe
		// Payment Record ID locally. Null for comped tickets and free RSVPs,
		// which never go through Stripe, and for tickets still `pending`.
		stripePaymentRecordId: text('stripe_payment_record_id'),
		// What this pass cost, in cents, after any member discount. 0 for comped
		// tickets and free claims; null on rows written before this column existed.
		// Stripe is still the payment ledger — this is the per-ticket outcome, kept
		// locally because two buyers at the same show can now pay different amounts.
		unitPriceCents: integer('unit_price_cents'),
		// The buyer's optional gift for the whole order. An order-level fact with no
		// order table, so it is recorded once on the purchase's first ticket —
		// summing it across a `purchaseId` counts the gift exactly once.
		contributionCents: integer('contribution_cents').notNull().default(0),
		// An eligible sustaining member chose to pay full price for this purchase.
		// No longer written: the member ticket discount is gone, and with a sliding
		// scale there is no line-item discount left to decline. Kept because it is
		// still true of the rows that have it.
		discountWaived: integer('discount_waived', { mode: 'boolean' }).notNull().default(false),
		// Where the buyer asked their money to go, recorded — not routed. Every
		// dollar still lands in CMC's single Stripe account; these are what staff
		// settle from. A touring act is paid the way a contractor is (see
		// `contractor.ts`), deliberately: no act should need a Stripe Connect
		// account to get paid for playing a show.
		//
		// Order-level, like `contributionCents` above and for the same reason —
		// stamped on the purchase's first ticket, so summing across a `purchaseId`
		// counts the allocation exactly once.
		actsCents: integer('acts_cents').notNull().default(0),
		collectiveCents: integer('collective_cents').notNull().default(0),
		// The surcharge, when the buyer covered card processing. Recorded so the
		// figures reconcile without a Stripe round trip:
		//   unitPriceCents × qty + contributionCents + feeCoveredCents
		//     = actsCents + collectiveCents + Stripe's fee
		feeCoveredCents: integer('fee_covered_cents').notNull().default(0),
		checkedInAt: integer('checked_in_at', { mode: 'timestamp' }),
		checkedInByUserId: text('checked_in_by_user_id').references(() => user.id, {
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
		index('idx_ticket_event').on(t.eventId),
		index('idx_ticket_purchase').on(t.purchaseId),
		index('idx_ticket_user').on(t.userId),
		index('idx_ticket_event_status').on(t.eventId, t.status)
	]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type Ticket = typeof ticket.$inferSelect;
