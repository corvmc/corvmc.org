import { db } from '$lib/server/db';
import { workOrder } from '$lib/server/db/schema/volunteer';
import { eventListing } from '$lib/server/db/schema/event';
import { and, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import { cancelShift } from './work-order-service';
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
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				or(isNull(workOrder.endsAt), gt(workOrder.endsAt, now))
			)
		);

	for (const { id } of live) {
		await cancelShift(id, cancelledByUserId ?? undefined);
		await notifySignupsOfCancellation(id);
	}
	return live.length;
}

export function cancelShiftsForEvent(eventId: string, cancelledByUserId?: string | null) {
	return cancelLiveShifts(eq(eventListing.id, eventId), cancelledByUserId);
}

/** Every listing announcing the production; the production itself holds no work orders. */
export function cancelShiftsForProduction(productionId: string, cancelledByUserId?: string | null) {
	return cancelLiveShifts(eq(eventListing.productionId, productionId), cancelledByUserId);
}
