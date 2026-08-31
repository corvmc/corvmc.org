import { getConfigsByPrefix } from '$lib/server/site-config/site-config-service';
import type { BookerType } from '$lib/server/db/schema/reservation';

// ---------------------------------------------------------------------------
// Defaults — kept as named exports for tests and static references
// ---------------------------------------------------------------------------

export const DEFAULT_TIME_SLOT_MINUTES = 30;
export const DEFAULT_MIN_DURATION_HOURS = 1;
export const DEFAULT_MAX_DURATION_HOURS = 8;
export const DEFAULT_OPERATING_HOURS_START = '09:00';
export const DEFAULT_OPERATING_HOURS_END = '22:00';
export const DEFAULT_BUFFER_MINUTES = 0;
export const DEFAULT_MIN_ADVANCE_MINUTES = 60;
export const DEFAULT_MAX_ADVANCE_DAYS_ONEOFF = 14;
export const DEFAULT_MAX_ADVANCE_DAYS_RECURRING = 17.5;

// Teaching terms. $5/hr is not a discount on the $15 above — it is the rate a
// sustaining member's contribution already buys (`webhook-handlers.ts`: "$5 = 1
// hour = 2 credits"). The $15 is the drop-in rate for hours past the monthly
// allocation, so teaching status lifts the cap rather than cutting the price.
export const DEFAULT_TEACHING_RATE_CENTS = 500;
// A half-hour lesson is the unit, and `minDurationHours: 1` forbids it outright.
export const DEFAULT_TEACHING_MIN_DURATION_HOURS = 0.5;
// A teaching studio is a standing arrangement a student pays for a term of. At
// 14 days a teacher cannot tell a student when their next four lessons are.
export const DEFAULT_TEACHING_MAX_ADVANCE_DAYS_ONEOFF = 60;
export const DEFAULT_TEACHING_MAX_ADVANCE_DAYS_RECURRING = 90;

// ---------------------------------------------------------------------------
// Async config — reads from site_config table with defaults fallback
// ---------------------------------------------------------------------------

export interface ReservationConfig {
	timeSlotMinutes: number;
	minDurationHours: number;
	maxDurationHours: number;
	operatingHoursStart: string;
	operatingHoursEnd: string;
	bufferMinutes: number;
	minAdvanceMinutes: number;
	maxAdvanceDaysOneoff: number;
	maxAdvanceDaysRecurring: number;
	hourlyRateCents: number;
	teachingRateCents: number;
	teachingMinDurationHours: number;
	teachingMaxAdvanceDaysOneoff: number;
	teachingMaxAdvanceDaysRecurring: number;
}

export async function getReservationConfig(): Promise<ReservationConfig> {
	const raw = await getConfigsByPrefix('reservation');
	return {
		timeSlotMinutes: Number(raw.timeSlotMinutes ?? DEFAULT_TIME_SLOT_MINUTES),
		minDurationHours: Number(raw.minDurationHours ?? DEFAULT_MIN_DURATION_HOURS),
		maxDurationHours: Number(raw.maxDurationHours ?? DEFAULT_MAX_DURATION_HOURS),
		operatingHoursStart: String(raw.operatingHoursStart ?? DEFAULT_OPERATING_HOURS_START),
		operatingHoursEnd: String(raw.operatingHoursEnd ?? DEFAULT_OPERATING_HOURS_END),
		bufferMinutes: Number(raw.bufferMinutes ?? DEFAULT_BUFFER_MINUTES),
		minAdvanceMinutes: Number(raw.minAdvanceMinutes ?? DEFAULT_MIN_ADVANCE_MINUTES),
		maxAdvanceDaysOneoff: Number(raw.maxAdvanceDaysOneoff ?? DEFAULT_MAX_ADVANCE_DAYS_ONEOFF),
		maxAdvanceDaysRecurring: Number(
			raw.maxAdvanceDaysRecurring ?? DEFAULT_MAX_ADVANCE_DAYS_RECURRING
		),
		hourlyRateCents: Number(raw.hourlyRateCents ?? 1500),
		teachingRateCents: Number(raw.teachingRateCents ?? DEFAULT_TEACHING_RATE_CENTS),
		teachingMinDurationHours: Number(
			raw.teachingMinDurationHours ?? DEFAULT_TEACHING_MIN_DURATION_HOURS
		),
		teachingMaxAdvanceDaysOneoff: Number(
			raw.teachingMaxAdvanceDaysOneoff ?? DEFAULT_TEACHING_MAX_ADVANCE_DAYS_ONEOFF
		),
		teachingMaxAdvanceDaysRecurring: Number(
			raw.teachingMaxAdvanceDaysRecurring ?? DEFAULT_TEACHING_MAX_ADVANCE_DAYS_RECURRING
		)
	};
}

// ---------------------------------------------------------------------------
// Booking terms — the per-booker-type half of the config
// ---------------------------------------------------------------------------

/**
 * What a booking costs and how far ahead it may be made, resolved for *who* is
 * booking.
 *
 * The split is by what the number is a fact about. Facts about the **room** —
 * operating hours, slot size, buffer, minimum advance, maximum duration — are
 * identical for everyone and stay on `ReservationConfig`. Facts about **who is
 * booking** live here, behind a resolver, so no caller reads a rate directly and
 * none can pick the member rate for a teaching booking by accident.
 *
 * There is deliberately no `creditsApply` flag. An earlier draft carried one to
 * withhold free hours from teaching; that was reversed once the rates turned out
 * to be the same number, and a flag that is always `true` is config nothing
 * reads. Off-peak pricing may want one — an off-peak rate need not be a whole
 * number of credit-halves — and it can add it with a case to point at.
 */
export interface BookingTerms {
	hourlyRateCents: number;
	minDurationHours: number;
	maxAdvanceDaysOneoff: number;
	maxAdvanceDaysRecurring: number;
}

/**
 * Pure, so the mapping is testable without a config read. Matches positively on
 * `'instructor'`: a booker type added later inherits member terms rather than
 * silently acquiring teaching ones.
 */
export function termsFor(bookerType: BookerType, cfg: ReservationConfig): BookingTerms {
	if (bookerType === 'instructor') {
		return {
			hourlyRateCents: cfg.teachingRateCents,
			minDurationHours: cfg.teachingMinDurationHours,
			maxAdvanceDaysOneoff: cfg.teachingMaxAdvanceDaysOneoff,
			maxAdvanceDaysRecurring: cfg.teachingMaxAdvanceDaysRecurring
		};
	}
	return {
		hourlyRateCents: cfg.hourlyRateCents,
		minDurationHours: cfg.minDurationHours,
		maxAdvanceDaysOneoff: cfg.maxAdvanceDaysOneoff,
		maxAdvanceDaysRecurring: cfg.maxAdvanceDaysRecurring
	};
}

/** One config read, then `termsFor`. The form every call site should take. */
export async function getBookingTerms(bookerType: BookerType): Promise<BookingTerms> {
	return termsFor(bookerType, await getReservationConfig());
}
