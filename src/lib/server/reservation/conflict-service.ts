import { db } from '$lib/server/db';
import { reservation, closure } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { and, ne, eq, lt, gt, notInArray } from 'drizzle-orm';
import type { BookerType } from '$lib/config';
import { getReservationConfig, termsFor } from './config';
import { buildDateInTz, formatTimeInTz } from './timezone';
import type { TimeSlot } from '$lib/server/db/schema/reservation';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// ConflictService — availability checks and slot generation
// ---------------------------------------------------------------------------

/**
 * Check whether a proposed time range conflicts with any existing
 * non-cancelled reservation or closure.
 */
export async function hasConflict(
	startsAt: Date,
	endsAt: Date,
	excludeReservationId?: string
): Promise<boolean> {
	const { bufferMinutes } = await getReservationConfig();
	const bufferMs = bufferMinutes * 60 * 1000;
	const bufferedStart = new Date(startsAt.getTime() - bufferMs);
	const bufferedEnd = new Date(endsAt.getTime() + bufferMs);

	// Check reservations
	const reservationConflicts = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, bufferedEnd),
				gt(reservation.endsAt, bufferedStart),
				excludeReservationId ? ne(reservation.id, excludeReservationId) : undefined
			)
		)
		.limit(1);

	if (reservationConflicts.length > 0) return true;

	// Check closures (no buffer applied)
	const closureConflicts = await db
		.select({ id: closure.id })
		.from(closure)
		.where(and(lt(closure.startsAt, endsAt), gt(closure.endsAt, startsAt)))
		.limit(1);

	return closureConflicts.length > 0;
}

/** A booked or closed interval, as the slot builder reads it. */
export interface BusyInterval {
	startsAt: Date;
	endsAt: Date;
}

type SlotConfig = Awaited<ReturnType<typeof getReservationConfig>>;

/**
 * One day's slots from rows already fetched. Pure: rows outside the day's
 * operating window are ignored, so a caller may pass a whole range's rows.
 */
export function buildDaySlots(
	dateStr: string,
	config: SlotConfig,
	reservations: BusyInterval[],
	closures: BusyInterval[],
	now: number = Date.now()
): TimeSlot[] {
	const tz = DEFAULT_TIMEZONE;
	const dayStart = buildDateInTz(dateStr, config.operatingHoursStart, tz);
	const dayEnd = buildDateInTz(dateStr, config.operatingHoursEnd, tz);
	const overlapsDay = (r: BusyInterval) => r.startsAt < dayEnd && r.endsAt > dayStart;
	const dayReservations = reservations.filter(overlapsDay);
	const dayClosures = closures.filter(overlapsDay);

	const slots: TimeSlot[] = [];
	const slotMs = config.timeSlotMinutes * 60 * 1000;
	const bufferMs = config.bufferMinutes * 60 * 1000;
	const earliestStart = now + config.minAdvanceMinutes * 60 * 1000;

	for (let time = dayStart.getTime(); time < dayEnd.getTime(); time += slotMs) {
		const slotStart = time;
		const slotEnd = time + slotMs;

		// Reservations block their buffer too; closures do not.
		const blockedByReservation = dayReservations.some(
			(r) => slotStart < r.endsAt.getTime() + bufferMs && slotEnd > r.startsAt.getTime() - bufferMs
		);
		const blockedByClosure = dayClosures.some(
			(c) => slotStart < c.endsAt.getTime() && slotEnd > c.startsAt.getTime()
		);

		slots.push({
			startTime: formatTimeInTz(new Date(slotStart), tz),
			endTime: formatTimeInTz(new Date(slotEnd), tz),
			available: !blockedByReservation && !blockedByClosure && slotStart >= earliestStart
		});
	}

	return slots;
}

/**
 * Slots for several days, keyed by date string, from one reservation query and
 * one closure query spanning all of them.
 *
 * @param dateStrs  Calendar days as "YYYY-MM-DD", each anchored to the literal
 *   string in {@link DEFAULT_TIMEZONE} — never re-derived from a `Date` — so
 *   the result matches the submit/validation path whatever the runtime timezone.
 */
export async function getAvailableSlotsForDates(
	dateStrs: string[]
): Promise<Map<string, TimeSlot[]>> {
	const result = new Map<string, TimeSlot[]>();
	if (dateStrs.length === 0) return result;

	const tz = DEFAULT_TIMEZONE;
	const config = await getReservationConfig();
	const starts = dateStrs.map((d) => buildDateInTz(d, config.operatingHoursStart, tz).getTime());
	const ends = dateStrs.map((d) => buildDateInTz(d, config.operatingHoursEnd, tz).getTime());
	const rangeStart = new Date(Math.min(...starts));
	const rangeEnd = new Date(Math.max(...ends));

	const [reservations, closures] = await Promise.all([
		db
			.select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt })
			.from(reservation)
			.where(
				and(
					notInArray(reservation.status, ['cancelled', 'waitlisted']),
					lt(reservation.startsAt, rangeEnd),
					gt(reservation.endsAt, rangeStart)
				)
			),
		db
			.select({ startsAt: closure.startsAt, endsAt: closure.endsAt })
			.from(closure)
			.where(and(lt(closure.startsAt, rangeEnd), gt(closure.endsAt, rangeStart)))
	]);

	const now = Date.now();
	for (const d of dateStrs) result.set(d, buildDaySlots(d, config, reservations, closures, now));
	return result;
}

/** One day's slots within operating hours, marked available or not. */
export async function getAvailableSlots(dateStr: string): Promise<TimeSlot[]> {
	return (await getAvailableSlotsForDates([dateStr])).get(dateStr) ?? [];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Why a booking was refused. The `error` beside it is the sentence shown to the
 * member and is free to be reworded; `code` is the stable handle tests and
 * callers branch on.
 */
export type BookingRejection =
	| 'END_BEFORE_START'
	| 'MIN_DURATION'
	| 'MAX_DURATION'
	| 'SLOT_BOUNDARY'
	| 'BEFORE_OPENING'
	| 'AFTER_CLOSING'
	| 'TOO_SOON'
	| 'TOO_FAR_AHEAD';

export interface ValidationResult {
	valid: boolean;
	code?: BookingRejection;
	error?: string;
}

export interface ValidateBookingOptions {
	/** Set to true for recurring series generation (uses longer advance window) */
	isRecurring?: boolean;
	/**
	 * Who is booking, which decides the duration floor and the advance window.
	 * Defaults to `'user'`, so every existing caller keeps member terms.
	 *
	 * Without this a teaching booking cannot exist: a half-hour lesson is
	 * refused by `minDurationHours: 1`, and a term of lessons by the 14-day
	 * window. `getValidationWarnings` takes it for the same reason — staff
	 * would otherwise be warned that a perfectly valid lesson is too short.
	 */
	bookerType?: BookerType;
}

/**
 * Validate that a proposed booking time is within operating constraints.
 * Does not check conflicts — that's a separate DB query.
 */
export async function validateBooking(
	startsAt: Date,
	endsAt: Date,
	options?: ValidateBookingOptions
): Promise<ValidationResult> {
	const tz = DEFAULT_TIMEZONE;
	const config = await getReservationConfig();
	// Room facts come from `config`; booker facts from `terms`. Reading a window
	// off `config` here is exactly what the resolver exists to prevent.
	const terms = termsFor(options?.bookerType ?? 'user', config);

	if (endsAt <= startsAt) {
		return { valid: false, code: 'END_BEFORE_START', error: 'End time must be after start time' };
	}

	const durationMs = endsAt.getTime() - startsAt.getTime();
	const durationHours = durationMs / (1000 * 60 * 60);

	if (durationHours < terms.minDurationHours) {
		return {
			valid: false,
			code: 'MIN_DURATION',
			error: `Minimum duration is ${terms.minDurationHours} hour`
		};
	}

	if (durationHours > config.maxDurationHours) {
		return {
			valid: false,
			code: 'MAX_DURATION',
			error: `Maximum duration is ${config.maxDurationHours} hours`
		};
	}

	// Check slot boundaries
	const startMinutes = startsAt.getMinutes();
	const endMinutes = endsAt.getMinutes();
	if (startMinutes % config.timeSlotMinutes !== 0 || endMinutes % config.timeSlotMinutes !== 0) {
		return {
			valid: false,
			code: 'SLOT_BOUNDARY',
			error: `Times must be on ${config.timeSlotMinutes}-minute boundaries`
		};
	}

	// Check operating hours
	const startTime = formatTimeInTz(startsAt, tz);
	const endTime = formatTimeInTz(endsAt, tz);

	if (startTime < config.operatingHoursStart) {
		return {
			valid: false,
			code: 'BEFORE_OPENING',
			error: `Cannot start before ${config.operatingHoursStart}`
		};
	}

	if (endTime > config.operatingHoursEnd) {
		return {
			valid: false,
			code: 'AFTER_CLOSING',
			error: `Cannot end after ${config.operatingHoursEnd}`
		};
	}

	// The near end of the window, which the slot picker also applies. A past start
	// falls inside it too. Staff paths use `staffCreate`, which never calls this.
	if (startsAt.getTime() < Date.now() + config.minAdvanceMinutes * 60 * 1000) {
		return {
			valid: false,
			code: 'TOO_SOON',
			error: `Bookings must start at least ${config.minAdvanceMinutes} minutes from now`
		};
	}

	// Check advance booking window
	const maxDays = options?.isRecurring ? terms.maxAdvanceDaysRecurring : terms.maxAdvanceDaysOneoff;
	const maxMs = maxDays * 24 * 60 * 60 * 1000;
	if (startsAt.getTime() - Date.now() > maxMs) {
		return {
			valid: false,
			code: 'TOO_FAR_AHEAD',
			error: `Cannot book more than ${maxDays} days in advance`
		};
	}

	return { valid: true };
}

// ---------------------------------------------------------------------------
// getConflictDetails() — detailed conflict info for staff override warnings
// ---------------------------------------------------------------------------

export interface ConflictDetail {
	type: 'reservation' | 'closure';
	/** Set for reservations only — lets a caller drop its own hold from the list. */
	id?: string;
	startsAt: Date;
	endsAt: Date;
	label: string;
}

export async function getConflictDetails(startsAt: Date, endsAt: Date): Promise<ConflictDetail[]> {
	const { bufferMinutes } = await getReservationConfig();
	const bufferMs = bufferMinutes * 60 * 1000;
	const bufferedStart = new Date(startsAt.getTime() - bufferMs);
	const bufferedEnd = new Date(endsAt.getTime() + bufferMs);

	const reservationConflicts = await db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			userName: user.name
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, bufferedEnd),
				gt(reservation.endsAt, bufferedStart)
			)
		);

	const closureConflicts = await db
		.select({
			startsAt: closure.startsAt,
			endsAt: closure.endsAt,
			reason: closure.reason
		})
		.from(closure)
		.where(and(lt(closure.startsAt, endsAt), gt(closure.endsAt, startsAt)));

	const details: ConflictDetail[] = [];

	for (const r of reservationConflicts) {
		details.push({
			type: 'reservation',
			id: r.id,
			startsAt: r.startsAt,
			endsAt: r.endsAt,
			label: r.userName
		});
	}

	for (const c of closureConflicts) {
		details.push({
			type: 'closure',
			startsAt: c.startsAt,
			endsAt: c.endsAt,
			label: c.reason
		});
	}

	return details;
}

// ---------------------------------------------------------------------------
// getValidationWarnings() — human-readable warnings without throwing
// ---------------------------------------------------------------------------

export async function getValidationWarnings(
	startsAt: Date,
	endsAt: Date,
	options?: ValidateBookingOptions
): Promise<string[]> {
	const tz = DEFAULT_TIMEZONE;
	const config = await getReservationConfig();
	// Room facts come from `config`; booker facts from `terms`. Reading a window
	// off `config` here is exactly what the resolver exists to prevent.
	const terms = termsFor(options?.bookerType ?? 'user', config);
	const warnings: string[] = [];

	if (endsAt <= startsAt) {
		warnings.push('End time must be after start time');
		return warnings;
	}

	const durationMs = endsAt.getTime() - startsAt.getTime();
	const durationHours = durationMs / (1000 * 60 * 60);

	if (durationHours < terms.minDurationHours) {
		warnings.push(`Duration is less than the ${terms.minDurationHours}-hour minimum`);
	}

	if (durationHours > config.maxDurationHours) {
		warnings.push(`Duration exceeds the ${config.maxDurationHours}-hour maximum`);
	}

	const startMinutes = startsAt.getMinutes();
	const endMinutes = endsAt.getMinutes();
	if (startMinutes % config.timeSlotMinutes !== 0 || endMinutes % config.timeSlotMinutes !== 0) {
		warnings.push(`Times must be on ${config.timeSlotMinutes}-minute boundaries`);
	}

	const startTime = formatTimeInTz(startsAt, tz);
	const endTime = formatTimeInTz(endsAt, tz);

	if (startTime < config.operatingHoursStart || endTime > config.operatingHoursEnd) {
		warnings.push(
			`Outside operating hours (${config.operatingHoursStart} – ${config.operatingHoursEnd})`
		);
	}

	const maxDays = options?.isRecurring ? terms.maxAdvanceDaysRecurring : terms.maxAdvanceDaysOneoff;
	const maxMs = maxDays * 24 * 60 * 60 * 1000;
	if (startsAt.getTime() - Date.now() > maxMs) {
		warnings.push(`More than ${maxDays} days in advance`);
	}

	return warnings;
}
