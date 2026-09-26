import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { dutyList, workOrder } from '$lib/server/db/schema/volunteer';
import type { DutyListAnchor } from '$lib/config';

/**
 * Move a show's duty-list shifts with the time they were measured from.
 *
 * A delta, not a recomputation: `work_order` does not record which item made it,
 * and a shift a coordinator moved by hand keeps its adjustment. `deltaSeconds`
 * is SQL so the caller can read the old time inside the same batch that writes
 * the new one. Closed and cancelled work stays where it happened.
 */
export function shiftAnchoredWorkOrders(
	eventId: string,
	anchors: readonly DutyListAnchor[],
	deltaSeconds: SQL
) {
	const moved = (column: typeof workOrder.startsAt) => sql`${column} + (${deltaSeconds})`;
	return db
		.update(workOrder)
		.set({
			startsAt: moved(workOrder.startsAt),
			endsAt: moved(workOrder.endsAt),
			dueAt: moved(workOrder.dueAt),
			updatedAt: new Date()
		})
		.where(
			and(
				eq(workOrder.eventId, eventId),
				inArray(
					workOrder.dutyListId,
					db
						.select({ id: dutyList.id })
						.from(dutyList)
						.where(inArray(dutyList.anchor, [...anchors]))
				),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				sql`(${deltaSeconds}) is not null and (${deltaSeconds}) != 0`
			)
		);
}
