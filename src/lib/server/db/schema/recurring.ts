import { sqliteTable, text, index, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Recurring domain types
// ---------------------------------------------------------------------------

export const RECURRING_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

// `'lesson'` was removed alongside `bookerTypes`'. A lesson series could only
// ever have had a lesson reservation as its prototype, and production holds
// none of those. Removing it emits no SQL — this is a TypeScript-only enum.
export const prototypeTypes = ['event', 'reservation'] as const;
export type PrototypeType = (typeof prototypeTypes)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const recurringSeries = sqliteTable(
	'recurring_series',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		supersededBy: text('superseded_by'),
		prototypeType: text('prototype_type', { enum: prototypeTypes }).notNull(),
		prototypeId: text('prototype_id').notNull(),
		rrule: text('rrule').notNull(),
		createdBy: text('created_by')
			.references(() => user.id)
			.notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		endsAt: integer('ends_at', { mode: 'timestamp' }),
		cancelledAt: integer('cancelled_at', { mode: 'timestamp' })
	},
	(t) => [
		index('idx_recurring_series_active')
			.on(t.prototypeType)
			.where(sql`cancelled_at IS NULL AND superseded_by IS NULL`),
		index('idx_recurring_series_prototype').on(t.prototypeType, t.prototypeId)
	]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type RecurringSeries = typeof recurringSeries.$inferSelect;
