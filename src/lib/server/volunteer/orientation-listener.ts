import { db } from '$lib/server/db';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { domainEvents } from '$lib/server/event-bus';
import { dutyList, workOrder } from '$lib/server/db/schema/volunteer';
import { priorBookingCount } from '$lib/server/reservation/reservation-service';
import { applyDutyList, DutyListAlreadyAppliedError } from './duty-list-service';
import {
	cancelOrientationFor,
	completeOrientation,
	orientationOwnerOf,
	rescheduleOrientationFor,
	scheduleOrientation
} from './orientation-service';

/**
 * A member's first rehearsal booking raises a shift to meet them at the door.
 *
 * What the orientation *is* — which role, how far ahead, how long, which
 * checklist — is a duty list staff can edit, found by its `auto_apply_on`
 * trigger rather than by a name or a constant. Until one exists the feature is
 * simply off, which is the degradation story for production: no seed, no
 * shifts, no errors.
 */

/** Registered from `registerListeners()`, which is itself idempotent. */
export function registerOrientationListeners(): void {
	domainEvents.on('reservation.created', async ({ data: event }) => {
		try {
			// A band's rehearsal hold or a staff-created event hold is not somebody's
			// first visit — the same rule `isFirstReservationSql` states, checked
			// first because it is the cheapest and rules out most bookings.
			if (event.bookerType !== 'user') return;

			const list = await findAutoApplyList();
			if (!list) return;

			const prior = await priorBookingCount(
				event.userId,
				new Date(event.startsAt),
				event.reservationId
			);
			if (prior !== 0) return;

			let workOrderIds: string[];
			try {
				workOrderIds = (
					await applyDutyList(list.id, { kind: 'reservation', id: event.reservationId }, null)
				).workOrderIds;
			} catch (err) {
				// The bus has no dedupe, so a re-delivered event lands here a second
				// time — and `applyDutyList`'s re-apply guard is what stops it doubling
				// the roster. Refusing by name is the correct outcome, not a failure:
				// the machinery that stops a coordinator double-clicking Apply is the
				// machinery that makes this listener idempotent.
				if (err instanceof DutyListAlreadyAppliedError) return;
				throw err;
			}

			const first = await earliestScheduled(workOrderIds);
			if (!first) return;

			await scheduleOrientation({
				userId: event.userId,
				reservationId: event.reservationId,
				workOrderId: first.id,
				scheduledFor: first.startsAt
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

async function findAutoApplyList() {
	const [row] = await db
		.select({ id: dutyList.id })
		.from(dutyList)
		.where(
			and(
				eq(dutyList.autoApplyOn, 'reservation.first'),
				eq(dutyList.subject, 'reservation'),
				eq(dutyList.isActive, true)
			)
		)
		.limit(1);

	return row ?? null;
}

/**
 * The soonest shift the list produced, which is the one the member turns up to.
 *
 * A list could carry an unscheduled item — advance work with a deadline and no
 * window — and that is not the moment anybody is met at the door, so this only
 * considers rows that have a start.
 */
async function earliestScheduled(workOrderIds: string[]) {
	if (workOrderIds.length === 0) return null;

	const [row] = await db
		.select({ id: workOrder.id, startsAt: workOrder.startsAt })
		.from(workOrder)
		.where(and(inArray(workOrder.id, workOrderIds), isNotNull(workOrder.startsAt)))
		.orderBy(asc(workOrder.startsAt))
		.limit(1);

	return row?.startsAt ? { id: row.id, startsAt: row.startsAt } : null;
}
