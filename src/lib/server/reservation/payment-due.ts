import { and, eq, gt, isNull, notInArray, or } from 'drizzle-orm';
import { eventHoldBookers } from '#lib/config.js';
import { reservation } from '#lib/server/db/schema/reservation.js';

/**
 * Confirmed, not paid, and owing something: a null `cashDueCents` was never
 * priced, so it is owed in full. Event holds are never charged. The SQL twin of
 * `owesMoney` in `reservation-actions`; the spec holds the two together. The
 * staff list, the fee gate and auto-complete all read this one definition.
 */
export function confirmedUnpaidSql() {
	return and(
		eq(reservation.status, 'confirmed'),
		isNull(reservation.paidAt),
		isNull(reservation.refundedAt),
		or(isNull(reservation.cashDueCents), gt(reservation.cashDueCents, 0)),
		notInArray(reservation.bookerType, [...eventHoldBookers])
	)!;
}
