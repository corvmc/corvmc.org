import { db } from '$lib/server/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { dutyList, memberOrientation, workOrder } from '$lib/server/db/schema/volunteer';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import type { MemberOrientation } from '$lib/server/db/schema/volunteer';
import type { MemberOrientationState } from '$lib/config';
import { cancelShift, countActiveSignups } from './work-order-service';

/**
 * Whether a member has been shown around the space, and when.
 *
 * One row per member, reused rather than appended to: this answers "has this
 * person been shown around", which is one fact about them — unlike
 * `member_certification`, where each renewal is its own grant with its own
 * expiry and the ledger has to keep all of them.
 *
 * The state is **derived**, which is the whole design. See
 * `memberOrientationStates` in `$lib/config` for why; the short version is that
 * an orientation nobody claims never emits a completion event, so a stored
 * status would sit at `scheduled` for ever with its time in the past and need a
 * cron to un-stick it.
 */

export interface MemberOrientationView extends MemberOrientation {
	state: MemberOrientationState;
}

/**
 * `workOrderLive` is "the shift still exists and has not been called off" —
 * the caller resolves it, because it is a join the callers who already have the
 * work order should not pay for twice.
 */
export function stateOf(
	row: MemberOrientation | null,
	workOrderLive: boolean,
	now: Date = new Date()
): MemberOrientationState {
	if (!row) return 'pending';
	// Actually being shown around outranks a staff note saying it was not needed,
	// whichever landed first.
	if (row.completedAt) return 'completed';
	if (row.waivedAt) return 'waived';
	if (workOrderLive && row.scheduledFor && row.scheduledFor >= now) return 'scheduled';
	// Cancelled shift, or a time that has passed with nobody having run it. Both
	// are "still needs booking", and neither needed a write to become true.
	return 'pending';
}

export async function getOrientation(
	userId: string,
	now: Date = new Date()
): Promise<MemberOrientationView | null> {
	const [row] = await db
		.select({
			orientation: memberOrientation,
			workOrderCancelledAt: workOrder.cancelledAt,
			workOrderId: workOrder.id
		})
		.from(memberOrientation)
		.leftJoin(workOrder, eq(workOrder.id, memberOrientation.workOrderId))
		.where(eq(memberOrientation.userId, userId))
		.limit(1);

	if (!row) return null;

	const live = row.workOrderId !== null && row.workOrderCancelledAt === null;
	return { ...row.orientation, state: stateOf(row.orientation, live, now) };
}

/**
 * Point a member's orientation at the shift that will run it.
 *
 * Upserts on the `user_id` unique constraint, so a re-delivered domain event or
 * a rebooking after a cancellation both land on the same row rather than
 * failing. Never touches `completed_at`: somebody already shown around who
 * books again does not become un-oriented.
 */
export async function scheduleOrientation(params: {
	userId: string;
	reservationId: string;
	workOrderId: string;
	scheduledFor: Date | null;
}): Promise<void> {
	const now = new Date();

	await db
		.insert(memberOrientation)
		.values({
			userId: params.userId,
			reservationId: params.reservationId,
			workOrderId: params.workOrderId,
			scheduledFor: params.scheduledFor
		})
		.onConflictDoUpdate({
			target: memberOrientation.userId,
			set: {
				reservationId: params.reservationId,
				workOrderId: params.workOrderId,
				scheduledFor: params.scheduledFor,
				updatedAt: now
			}
		});
}

/**
 * The member was shown around.
 *
 * `where completed_at is null` rather than a read-then-write, so the shift-
 * completion listener and a staff hand-close can both fire without the second
 * one overwriting who actually ran it.
 */
export async function completeOrientation(
	userId: string,
	opts: { completedByUserId: string | null; notes?: string | null }
): Promise<void> {
	const now = new Date();

	await db
		.update(memberOrientation)
		.set({
			completedAt: now,
			completedByUserId: opts.completedByUserId,
			notes: opts.notes ?? null,
			updatedAt: now
		})
		.where(and(eq(memberOrientation.userId, userId), isNull(memberOrientation.completedAt)));
}

/**
 * Staff say this member does not need one.
 *
 * The reason is required and the CHECK backs it up: the next staffer reading the
 * list needs to know why somebody is not on it, which is the same bargain
 * `member_certification_revoked_has_reason` strikes.
 */
export async function waiveOrientation(
	userId: string,
	opts: { waivedByUserId: string; reason: string }
): Promise<void> {
	const now = new Date();
	const reason = opts.reason.trim();

	await db
		.insert(memberOrientation)
		.values({
			userId,
			waivedAt: now,
			waivedReason: reason,
			waivedByUserId: opts.waivedByUserId
		})
		.onConflictDoUpdate({
			target: memberOrientation.userId,
			set: {
				waivedAt: now,
				waivedReason: reason,
				waivedByUserId: opts.waivedByUserId,
				updatedAt: now
			}
		});
}

export interface OrientationOwner {
	userId: string;
	name: string;
	email: string;
}

/**
 * Whose orientation is this work order, if it is one at all?
 *
 * Two conditions, and both are needed. `reservation_id` alone would catch any
 * future work order that hangs off a booking; the `auto_apply_on` join is what
 * says this row came from the orientation list rather than from some other list
 * a coordinator applied to the same booking.
 *
 * Returns the *member who booked*, not whoever worked the shift — and their
 * name and address with it, because both callers need to write to them and
 * neither should be running its own query to find out who they are.
 */
export async function orientationOwnerOf(workOrderId: string): Promise<OrientationOwner | null> {
	const [row] = await db
		.select({ userId: user.id, name: user.name, email: user.email })
		.from(workOrder)
		.innerJoin(reservation, eq(reservation.id, workOrder.reservationId))
		.innerJoin(user, eq(user.id, reservation.createdByUserId))
		.innerJoin(dutyList, eq(dutyList.id, workOrder.dutyListId))
		.where(and(eq(workOrder.id, workOrderId), eq(dutyList.autoApplyOn, 'reservation.first')))
		.limit(1);

	return row ?? null;
}

export interface ReservationOrientationShift {
	workOrderId: string;
	startsAt: Date | null;
	capacity: number;
	claimed: number;
}

/**
 * The live orientation shift staffing one booking, if there is one.
 *
 * For the staff booking page, which already asks "is this their first visit" and
 * whose next question is "so has anybody agreed to meet them". Returns null for
 * a cancelled shift as well as for no shift — from the desk's point of view
 * those are the same answer.
 */
export async function orientationForReservation(
	reservationId: string
): Promise<ReservationOrientationShift | null> {
	const [row] = await db
		.select({
			workOrderId: workOrder.id,
			startsAt: workOrder.startsAt,
			capacity: workOrder.capacity
		})
		.from(workOrder)
		.innerJoin(dutyList, eq(dutyList.id, workOrder.dutyListId))
		.where(
			and(
				eq(workOrder.reservationId, reservationId),
				eq(dutyList.autoApplyOn, 'reservation.first'),
				isNull(workOrder.cancelledAt)
			)
		)
		.limit(1);

	if (!row) return null;

	return { ...row, claimed: await countActiveSignups(row.workOrderId) };
}

/**
 * The booking is off, so the shift that staffed it is off.
 *
 * Keyed on the reservation rather than on the member, which is what makes
 * rebooking need no special case: the new booking gets its own orientation, and
 * this one stays cancelled as a record of what was called off.
 *
 * Goes through `cancelShift` rather than writing `cancelled_at` directly, so the
 * row lands in every staff surface exactly as a hand-cancelled shift does —
 * including the unnotified count and the "Notify all" button. Telling the
 * volunteer is deliberately still a person's decision; see the note on
 * `notifySignupsOfCancellation`.
 */
export async function cancelOrientationFor(
	reservationId: string,
	cancelledByUserId?: string
): Promise<number> {
	const live = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(
			and(
				eq(workOrder.reservationId, reservationId),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt)
			)
		);

	if (live.length === 0) return 0;

	for (const row of live) {
		await cancelShift(row.id, cancelledByUserId);
	}

	await clearScheduled(live.map((r) => r.id));
	return live.length;
}

/**
 * Forget a cancelled shift, which drops the member back to `pending`.
 *
 * `completed_at is null` is load-bearing: cancelling a *later* booking must
 * never un-orient somebody who has already been shown around.
 */
export async function clearScheduled(workOrderIds: string[]): Promise<void> {
	if (workOrderIds.length === 0) return;

	await db
		.update(memberOrientation)
		.set({ workOrderId: null, scheduledFor: null, updatedAt: new Date() })
		.where(
			and(
				inArray(memberOrientation.workOrderId, workOrderIds),
				isNull(memberOrientation.completedAt)
			)
		);
}
