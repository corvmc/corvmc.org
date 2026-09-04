import { sqliteTable, text, index, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { prototypeTypes } from '../../../config';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Recurring domain types
// ---------------------------------------------------------------------------

export const RECURRING_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

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
