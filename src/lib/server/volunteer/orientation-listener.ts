import { domainEvents } from '$lib/server/event-bus';
import { priorBookingCount } from '$lib/server/reservation/reservation-service';
import {
	cancelOrientationFor,
	completeOrientation,
	orientationOwnerOf,
	raiseOrientationShift,
	rescheduleOrientationFor,
	scheduleOrientation
} from './orientation-service';

/**
 * A member's first rehearsal booking raises a shift to meet them at the door.
 *
 * What the orientation *is* — which role, how long — is a setting
 * (`volunteer.orientationRoleId`, `volunteer.orientationMinutes`). Until a role
 * is set the feature is simply off: no shifts, no errors.
 */

/** Registered from `registerListeners()`, which is itself idempotent. */
export function registerOrientationListeners(): void {
	domainEvents.on('reservation.created', async ({ data: event }) => {
		try {
			// A band's rehearsal hold or a staff-created event hold is not somebody's
			// first visit — the same rule `isFirstReservationSql` states, checked
			// first because it is the cheapest and rules out most bookings.
			if (event.bookerType !== 'user') return;

			const prior = await priorBookingCount(
				event.userId,
				new Date(event.startsAt),
				event.reservationId
			);
			if (prior !== 0) return;

			// Reuses a live orientation shift already on the booking — a re-delivered
			// event, or one staff made by hand — so the roster is never doubled.
			const shift = await raiseOrientationShift(event.reservationId, new Date(event.startsAt));
			if (!shift?.startsAt) return;

			// `scheduleOrientation` upserts on `user_id`, so a re-delivery rewrites
			// the same three values and changes nothing.
			await scheduleOrientation({
				userId: event.userId,
				reservationId: event.reservationId,
				workOrderId: shift.id,
				scheduledFor: shift.startsAt
			});
		} catch (err) {
			// Best-effort, like every listener on this bus: a booking that succeeded
			// must not fail because nobody could be found to show them around.
			console.error('[orientation] failed to raise an orientation shift', err);
		}
	});

	domainEvents.on('reservation.cancelled', async ({ data: event }) => {
		try {
			await cancelOrientationFor(event.reservationId);
		} catch (err) {
			console.error('[orientation] failed to stand down an orientation shift', err);
		}
	});

	// A booking re-timed in place leaves its orientation shift behind, which is
	// worse than a cancelled one: the volunteer turns up at an hour nobody is
	// coming, and nothing on any screen says so.
	domainEvents.on('reservation.rescheduled', async ({ data: event }) => {
		try {
			const delta = new Date(event.startsAt).getTime() - new Date(event.previousStartsAt).getTime();
			await rescheduleOrientationFor(event.reservationId, delta);
		} catch (err) {
			console.error('[orientation] failed to move an orientation shift', err);
		}
	});

	// `completeFinishedShifts` promotes a signup once the clock runs out, and that
	// is the moment both facts are true at once: the shift happened, and somebody
	// was rostered on it. An orientation nobody claimed emits nothing here, which
	// is the correct answer and the reason the state is derived rather than
	// stored.
	domainEvents.on('volunteer.shift_completed', async ({ data: event }) => {
		try {
			const member = await orientationOwnerOf(event.shiftId);
			if (!member) return;

			// The member is the one who was shown around; `event.userId` is the
			// volunteer who did the showing.
			await completeOrientation(member.userId, { completedByUserId: event.userId });
		} catch (err) {
			console.error('[orientation] failed to record a completed orientation', err);
		}
	});
}
