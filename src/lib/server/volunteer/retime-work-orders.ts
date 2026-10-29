import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { workOrder } from '$lib/server/db/schema/volunteer';
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
				// The anchor stamped on the row, not the list's current one (#2033).
				inArray(workOrder.anchor, [...anchors]),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				sql`(${deltaSeconds}) is not null and (${deltaSeconds}) != 0`
			)
		);
}

/**
 * Schedule the work stamped while its anchor had no time, now that it has one.
 *
 * `atSeconds` is the anchor's new time as SQL. A row with a pending duration
 * becomes a window; one without becomes a deadline. Placing clears the
 * pending offsets, so the next move is an ordinary delta.
 */
export function placePendingWorkOrders(
	scope: { eventId: string } | { projectId: string },
	anchors: readonly DutyListAnchor[],
	atSeconds: SQL
) {
	const at = sql`(${atSeconds})`;
	const offset = sql`${workOrder.pendingOffsetMinutes} * 60`;
	const windowed = sql`${workOrder.pendingDurationMinutes} is not null`;
	return db
		.update(workOrder)
		.set({
			startsAt: sql`case when ${windowed} then ${at} + ${offset} end`,
			endsAt: sql`case when ${windowed} then ${at} + ${offset} + ${workOrder.pendingDurationMinutes} * 60 end`,
			dueAt: sql`case when ${windowed} then null else ${at} + ${offset} end`,
			pendingOffsetMinutes: null,
			pendingDurationMinutes: null,
			updatedAt: new Date()
		})
		.where(
			and(
				'eventId' in scope
					? eq(workOrder.eventId, scope.eventId)
					: eq(workOrder.projectId, scope.projectId),
				inArray(workOrder.anchor, [...anchors]),
				isNotNull(workOrder.pendingOffsetMinutes),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				sql`${at} is not null`
			)
		);
}
