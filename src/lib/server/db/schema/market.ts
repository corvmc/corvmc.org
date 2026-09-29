import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { eventListing } from './event';
import { inboxThread } from './inbox';
import { marketVendorStatuses } from '../../../config';

/**
 * A listing that takes vendor applications. See docs/specs/shipped/market-vendors-spec.md.
 *
 * Back-of-house, so it stays off `event_listing`, which is the advertisement.
 * The row existing is what opens the listing to applications.
 */
export const marketDay = sqliteTable('market_day', {
	eventId: text('event_id')
		.primaryKey()
		.references(() => eventListing.id, { onDelete: 'cascade' }),
	/** Null means applications stay open until the market starts. */
	applicationsCloseAt: integer('applications_close_at', { mode: 'timestamp' }),
	tableCount: integer('table_count'),
	/** Per table, charged on acceptance through the payments seam. Zero is a free market (#1502). */
	tableFeeCents: integer('table_fee_cents').notNull().default(0),
	/** Pay-what-you-can: a vendor may pay any amount from the floor up to the fee. */
	slidingScale: integer('sliding_scale', { mode: 'boolean' }).notNull().default(false),
	/** Per table. Read only while `sliding_scale` is on. */
	slidingScaleFloorCents: integer('sliding_scale_floor_cents').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

export type MarketDay = typeof marketDay.$inferSelect;

/**
 * One vendor's application to one market day.
 *
 * **No contact column, on purpose.** The vendor's name, email and phone live on
 * the `inbox_thread` the application opened, which only the staff inbox reads.
 * Accepted rows are published on the event page, so nothing here may be private.
 */
export const marketVendor = sqliteTable(
	'market_vendor',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => eventListing.id, { onDelete: 'cascade' }),
		threadId: text('thread_id').references(() => inboxThread.id, { onDelete: 'set null' }),
		businessName: text('business_name').notNull(),
		/** What they sell, in their words. Published when accepted. */
		offering: text('offering').notNull(),
		website: text('website'),
		tablesRequested: integer('tables_requested').notNull().default(1),
		needsPower: integer('needs_power', { mode: 'boolean' }).notNull().default(false),
		notes: text('notes'),
		status: text('status', { enum: marketVendorStatuses }).notNull().default('applied'),
		/** Free text — "B3", "by the door". There is no table map. */
		tableLabel: text('table_label'),
		decidedByUserId: text('decided_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		decidedAt: integer('decided_at', { mode: 'timestamp' }),
		/**
		 * What acceptance asked for, fixed then so a later change to the market's
		 * fee cannot move it. `fee_floor_cents` equals the fee unless the market
		 * runs a sliding scale. Zero owes nothing.
		 */
		feeCents: integer('fee_cents').notNull().default(0),
		feeFloorCents: integer('fee_floor_cents').notNull().default(0),
		paidCents: integer('paid_cents'),
		paidAt: integer('paid_at', { mode: 'timestamp' }),
		/** The payment intent: what a refund names. */
		stripePaymentRecordId: text('stripe_payment_record_id'),
		refundedAt: integer('refunded_at', { mode: 'timestamp' }),
		/** Arrival on the day (#1505). Only an `accepted` vendor carries one. */
		checkedInAt: integer('checked_in_at', { mode: 'timestamp' }),
		/** Null until someone says. Shown on this vendor's next application, matched by email. */
		inviteBack: integer('invite_back', { mode: 'boolean' }),
		inviteBackNote: text('invite_back_note'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_market_vendor_event_status').on(t.eventId, t.status)]
);

export type MarketVendor = typeof marketVendor.$inferSelect;
