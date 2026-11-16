import { db } from '#lib/server/db/index.js';
import { volunteerShift, workOrder } from '#lib/server/db/schema/volunteer.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { production } from '#lib/server/db/schema/production.js';
import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { cancelShift, hasLiveShiftSql, liveShift } from './work-order-service';
import { notifySignupsOfCancellation } from './volunteer-signup-service';

/**
 * A show that is off takes its crew shifts with it (#1705).
 *
 * Unlike a hand-cancelled shift, the claimants are told at once: there is no
 * reversible hurry to wait out, and nobody is left to press the notify button
 * on a show nobody is running. Resolved work and work that has already ended
 * is history and stays as it was. Returns how many work orders it called off.
 */
async function cancelLiveShifts(where: SQL, cancelledByUserId?: string | null): Promise<number> {
	const now = new Date();
	const live = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.innerJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(
			and(
				where,
				// A committee's deliverables go through the show's cancellation notice,
				// which tells the committee rather than the claimant (#1709).
				isNull(workOrder.groupId),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				// A task with no shift yet, or one with a shift still to come.
				or(
					sql`not ${hasLiveShiftSql()}`,
					sql`exists (
						select 1 from "volunteer_shift" s
						where s."work_order_id" = ${workOrder.id}
							and s."cancelled_at" is null
							and s."ends_at" > ${Math.floor(now.getTime() / 1000)}
					)`
				)
			)
		);

	for (const { id } of live) {
		const shifts = await db
			.select({ id: volunteerShift.id })
			.from(volunteerShift)
			.where(and(eq(volunteerShift.workOrderId, id), liveShift()));
		await cancelShift(id, cancelledByUserId ?? undefined);
		for (const shift of shifts) await notifySignupsOfCancellation(shift.id);
	}
	return live.length;
}

export function cancelShiftsForEvent(eventId: string, cancelledByUserId?: string | null) {
	return cancelLiveShifts(eq(eventListing.id, eventId), cancelledByUserId);
}

/** Every listing announcing the production; the production itself holds no work orders. */
export function cancelShiftsForProduction(productionId: string, cancelledByUserId?: string | null) {
	return cancelLiveShifts(
		inArray(
			eventListing.projectId,
			db
				.select({ id: production.projectId })
				.from(production)
				.where(eq(production.id, productionId))
		),
		cancelledByUserId
	);
}

/**
 * A deleted show's committee items, called off without a notice. The delete
 * nulls their `event_id`, and an item with no show would sit on its
 * committee's queue for good.
 */
export async function cancelDeliverablesForEvent(
	eventId: string,
	cancelledByUserId: string | null
) {
	const now = new Date();
	await db
		.update(workOrder)
		.set({ cancelledAt: now, cancelledByUserId, updatedAt: now })
		.where(
			and(
				eq(workOrder.eventId, eventId),
				isNotNull(workOrder.groupId),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt)
			)
		);
}
