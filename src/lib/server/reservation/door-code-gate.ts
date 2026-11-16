import { owesMoney, type PayableReservation } from '#lib/utils/reservation-actions.js';

/**
 * Teaching time gets no door code until it is paid (#3025): the code reveal,
 * the break-glass code and the `door_code_ready` notice all wait. Every surface
 * that hands a member a code asks this, as the door code pool on
 * `feature/door-check-in` (#2120) will. Member and band bookings are unaffected.
 */
export function doorCodeWithheld(r: PayableReservation): boolean {
	return r.bookerType === 'instructor' && owesMoney(r);
}
