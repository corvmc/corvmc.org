import { and, gt, inArray, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { eventHoldBookers } from '#lib/config.js';
import { payableStatuses, type ReservationTrack } from '#lib/utils/reservation-actions.js';
import { reservation } from '#lib/server/db/schema/reservation.js';

/** The stored statuses a payment or waiver may settle: `payableStatuses`. */
export function payableStatusSql() {
	return inArray(reservation.status, [...payableStatuses]);
}

/**
 * Confirmed or completed, not paid, and owing something: a null `cashDueCents`
 * was never priced, so it is owed in full. Event holds are never charged. The
 * SQL twin of `owesMoney` in `reservation-actions`; the spec holds the two
 * together. Auto-complete, the reminders and `paymentDueSql` read this.
 */
export function owesMoneySql() {
	return and(
		payableStatusSql(),
		isNull(reservation.paidAt),
		isNull(reservation.refundedAt),
		or(isNull(reservation.cashDueCents), gt(reservation.cashDueCents, 0)),
		notInArray(reservation.bookerType, [...eventHoldBookers])
	)!;
}

/**
 * The Payment due track: owing money on a session that has ended. The fee gate,
 * the staff filter and the Payment due dot all read this.
 */
export function paymentDueSql(now: Date) {
	return and(lt(reservation.endsAt, now), owesMoneySql())!;
}

/**
 * A reservation's track as a SQL value: the twin of `reservationTrack` in
 * `reservation-actions`, branch for branch. `reservation-track.spec.ts` runs
 * every combination of the columns through both and requires they agree.
 */
export function reservationTrackSql(now: Date): SQL<ReservationTrack> {
	const holds = sql.join(
		eventHoldBookers.map((b) => sql`${b}`),
		sql`, `
	);
	return sql<ReservationTrack>`(case
		when ${reservation.status} = 'waitlisted' then 'waitlisted'
		when ${reservation.status} = 'no_show' then 'no_show'
		when ${reservation.refundedAt} is not null then 'refunded'
		when ${reservation.status} = 'cancelled' then 'cancelled'
		when ${reservation.paidAt} is not null then 'paid'
		when ${paymentDueSql(now)} then 'payment_due'
		when ${owesMoneySql()} then 'booked'
		when ${reservation.status} = 'confirmed' and ${reservation.bookerType} in (${holds})
			and not ${lt(reservation.endsAt, now)} then 'booked'
		else 'covered' end)`;
}
