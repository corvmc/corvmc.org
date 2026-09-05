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
import { bookerTypes } from '../../../config';
import { recurringSeries } from './recurring';

// ---------------------------------------------------------------------------
// Reservation domain types
// ---------------------------------------------------------------------------

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
		// The lock-assigned user id, recovered by diffing the lock's user list
		// around the add — U-tec's `add` ack carries no id of its own.
		lockAccessId: text('lock_access_id'),
		// Per-reservation door lock code (not backfilled from legacy data).
		lockCode: text('lock_code'),
		// When the code was observed on the physical lock (`sync_status` 1), as
		// opposed to merely queued in U-tec's cloud. Null means we have issued a
		// code but cannot yet promise it opens the door.
		lockSyncedAt: integer('lock_synced_at', { mode: 'timestamp' }),
		// When the member was shown the break-glass code because their own could
		// not be confirmed. This is the audit trail for who was handed it.
		lockFallbackRevealedAt: integer('lock_fallback_revealed_at', { mode: 'timestamp' }),
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

/**
 * The break-glass door code.
 *
 * A code synced to the lock last month still opens the door while the lock is
 * offline today — the lock enforces access locally, it is only *changes* that
 * need connectivity. So one such code is kept alive and handed to a member
 * whose own reservation code cannot be confirmed.
 *
 * Exactly one row is active at a time: `syncedAt` set, `retiredAt` null. A
 * successor is minted before the incumbent is retired, never after, or there
 * would be a window with no working break-glass code — the precise failure this
 * exists to prevent.
 */
export const lockFallbackCode = sqliteTable(
	'lock_fallback_code',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		/** The keypad code itself. */
		code: text('code').notNull(),
		/** Lock-assigned user id; null until the add is reconciled. */
		lockAccessId: text('lock_access_id'),
		/** Set when the lock reports sync_status 1 — until then it opens nothing. */
		syncedAt: integer('synced_at', { mode: 'timestamp' }),
		/** Set when a confirmed successor has taken over. */
		retiredAt: integer('retired_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_lock_fallback_active').on(t.retiredAt, t.syncedAt)]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type Reservation = typeof reservation.$inferSelect;
export type Closure = typeof closure.$inferSelect;
export type LockFallbackCode = typeof lockFallbackCode.$inferSelect;
