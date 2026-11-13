import { sqliteTable, text, index, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { eventListing } from './event';

// Lightweight RSVP for non-ticketed events: a join row recording that a member is
// attending. Unlike `ticket`, there is no code, no check-in, and no capacity — it's a
// simple unlimited headcount. The unique (event_id, user_id) index keeps one RSVP per
// member per event.
export const eventRsvp = sqliteTable(
	'event_rsvp',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => eventListing.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		attendeeName: text('attendee_name').notNull(),
		attendeeEmail: text('attendee_email').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('idx_event_rsvp_event_user').on(t.eventId, t.userId),
		index('idx_event_rsvp_event').on(t.eventId)
	]
);

// Who came to a session, marked afterwards by a program lead. Its own table rather
// than a column on `event_rsvp`: a walk-in has no RSVP, and writing one for them
// would put them in RSVP counts and RSVP-built audiences. The unique index keeps
// one mark per member per event; unmarking deletes the row.
export const eventAttendance = sqliteTable(
	'event_attendance',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => eventListing.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		markedByUserId: text('marked_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('idx_event_attendance_event_user').on(t.eventId, t.userId),
		index('idx_event_attendance_user').on(t.userId)
	]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type EventRsvp = typeof eventRsvp.$inferSelect;
