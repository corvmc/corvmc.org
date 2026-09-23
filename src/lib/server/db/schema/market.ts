import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { eventListing } from './event';
import { inboxThread } from './inbox';
import { marketVendorStatuses } from '../../../config';

/**
 * A listing that takes vendor applications. See docs/specs/market-vendors-spec.md.
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
