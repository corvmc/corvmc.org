import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { venue } from './venue';

/**
 * A partner venue's published iCalendar feed, which the daily cron copies onto
 * the gig guide. Always a venue's: the importer dedupes against listings at
 * that venue, and the venue is where its shows are.
 *
 * `createdByUserId` is who added it and who owns what it imports, since every
 * `event_listing` needs an author. See docs/specs/shipped/partner-calendar-import-spec.md.
 */
export const calendarSource = sqliteTable(
	'calendar_source',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		venueId: text('venue_id')
			.notNull()
			.references(() => venue.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
		lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
		/** Null after a clean run. A failed fetch or parse leaves its message here. */
		lastError: text('last_error'),
		lastImportedCount: integer('last_imported_count'),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('uq_calendar_source_url').on(t.url),
		index('idx_calendar_source_venue').on(t.venueId)
	]
);

export type CalendarSource = typeof calendarSource.$inferSelect;
