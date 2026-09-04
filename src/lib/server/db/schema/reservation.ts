import {
	sqliteTable,
	text,
	index,
	uniqueIndex,
	check,
	integer,
	real
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';
import { recurringSeries } from './recurring';

// ---------------------------------------------------------------------------
// Reservation domain types
// ---------------------------------------------------------------------------

/**
 * Which table `bookerId` points into — a table discriminator, never a category.
 * `'instructor'` earns its place because `instructor` is a real table with real
 * ids; it is the capacity a person is booking in, not a label on the booking.
 *
 * A `'lesson'` value sat here unwritten from the reservation system's first day,
 * reserved for a module that had not been designed. It was removed once
 * production confirmed **zero rows carried it** — so nothing was renamed and
 * nothing was backfilled, which is what a rename would have required and what
 * would have minted staff grants out of historical data.
 */
export const bookerTypes = ['user', 'group', 'event_listing', 'instructor'] as const;
export type BookerType = (typeof bookerTypes)[number];

export function isBookerType(value: string): value is BookerType {
	return bookerTypes.includes(value as BookerType);
}

export const reservationStatuses = [
	'scheduled',
	'confirmed',
	'completed',
	'no_show',
	'cancelled',
	'waitlisted'
] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];

export interface TimeSlot {
	startTime: string;
	endTime: string;
	available: boolean;
}

export const createReservationSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
	startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format'),
	endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format'),
	notes: z.string().optional(),
	// Only submitted by members who have no usable number on file, so presence is
	// decided in the handler (which knows what's stored) rather than here.
	phone: z.string().trim().optional()
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const reservation = sqliteTable(
	'reservation',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		bookerType: text('booker_type', { enum: bookerTypes }).notNull(),
		bookerId: text('booker_id').notNull(),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// Audit trail: set only when a staff member books on the member's behalf.
		// `createdByUserId` stays the owning member (it drives owner authorization
		// and list joins throughout the app).
		createdByStaffId: text('created_by_staff_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		status: text('status', { enum: reservationStatuses }).notNull().default('scheduled'),
		startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
		endsAt: integer('ends_at', { mode: 'timestamp' }).notNull(),
		notes: text('notes'),
		cancellationReason: text('cancellation_reason'),
		stripePaymentRecordId: text('stripe_payment_record_id'),
		paidAt: integer('paid_at', { mode: 'timestamp' }),
		refundedAt: integer('refunded_at', { mode: 'timestamp' }),
		// Free credit-hours applied to this booking (legacy: reservations.free_hours_used).
		creditsUsed: real('credits_used'),
		// Cash owed at the door after free-hour credits are committed at Confirm.
		// null = not yet committed (plain scheduled); 0 = settled (fully credit-covered
		// or comped); > 0 = cash owed. Combined with paidAt: paidAt set ⇒ paid,
		// paidAt null & >0 ⇒ cash owed, paidAt null & 0 ⇒ comped/credit-settled.
		cashDueCents: integer('cash_due_cents'),
		lockAccessId: text('lock_access_id'),
		// Per-reservation door lock code (not backfilled from legacy data).
		lockCode: text('lock_code'),
		recurringSeriesId: text('recurring_series_id').references(() => recurringSeries.id, {
			onDelete: 'set null'
		}),
		waitlistNotifiedAt: integer('waitlist_notified_at', { mode: 'timestamp' }),
		waitlistExpiresAt: integer('waitlist_expires_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_reservation_conflict').on(t.startsAt, t.endsAt),
		index('idx_reservation_user').on(t.createdByUserId, t.status),
		index('idx_reservation_booker').on(t.bookerType, t.bookerId),
		uniqueIndex('uq_recurring_instance')
			.on(t.recurringSeriesId, t.startsAt)
			.where(sql`recurring_series_id IS NOT NULL AND status != 'cancelled'`),
		index('idx_reservation_waitlist_expires')
			.on(t.waitlistExpiresAt)
			.where(sql`status = 'waitlisted' AND waitlist_expires_at IS NOT NULL`),
		check('reservation_time_order', sql`ends_at > starts_at`)
	]
);

export const closure = sqliteTable(
	'closure',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		reason: text('reason').notNull(),
		startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
		endsAt: integer('ends_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_closure_time').on(t.startsAt, t.endsAt),
		check('closure_time_order', sql`ends_at > starts_at`)
	]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type Reservation = typeof reservation.$inferSelect;
export type Closure = typeof closure.$inferSelect;
