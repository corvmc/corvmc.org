import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { eventListing } from './event';

export const donationStatuses = ['pending', 'paid', 'cancelled'] as const;
export type DonationStatus = (typeof donationStatuses)[number];

/**
 * A card-present gift taken on the door phone (#2548). A door ticket has its
 * `ticket` rows; a gift has this: something for `payment_intent.succeeded` to
 * flip and the door screen to poll. The money itself is in `financial_entry`.
 */
export const donation = sqliteTable(
	'donation',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		paymentIntentId: text('payment_intent_id').notNull(),
		// The show it was given at, which scopes who may act on it.
		eventId: text('event_id').references(() => eventListing.id, { onDelete: 'set null' }),
		amountCents: integer('amount_cents').notNull(),
		status: text('status', { enum: donationStatuses }).notNull().default('pending'),
		takenByUserId: text('taken_by_user_id').references(() => user.id, { onDelete: 'set null' }),
		paidAt: integer('paid_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('uq_donation_payment_intent').on(t.paymentIntentId),
		index('idx_donation_event').on(t.eventId)
	]
);

export type Donation = typeof donation.$inferSelect;
