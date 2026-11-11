import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { volunteerShift, workOrder } from '#lib/server/db/schema/volunteer.js';
import type { DutyListAnchor } from '#lib/config.js';

/** Open tasks in scope, as a subquery a shift statement can filter on. */
function openTasksIn(scope: { eventId: string } | { projectId: string }) {
	return db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(
			and(
				'eventId' in scope
					? eq(workOrder.eventId, scope.eventId)
					: eq(workOrder.projectId, scope.projectId),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt)
			)
		);
}

/**
 * Move a show's duty-list shifts and deadlines by `deltaSeconds`, each by its own
 * stamped anchor (#2033): two statements for the caller's batch. A delta keeps a
 * hand-made adjustment; as SQL it reads the old time inside the batch that
 * writes the new one. Closed tasks and cancelled shifts stay put.
 */
export function shiftAnchoredWorkOrders(
	eventId: string,
	anchors: readonly DutyListAnchor[],
	deltaSeconds: SQL
) {
	const moves = sql`(${deltaSeconds}) is not null and (${deltaSeconds}) != 0`;
	const shifts = db
		.update(volunteerShift)
		.set({
			startsAt: sql`${volunteerShift.startsAt} + (${deltaSeconds})`,
			endsAt: sql`${volunteerShift.endsAt} + (${deltaSeconds})`,
			updatedAt: new Date()
		})
		.where(
			and(
				inArray(volunteerShift.workOrderId, openTasksIn({ eventId })),
				inArray(volunteerShift.anchor, [...anchors]),
				isNull(volunteerShift.cancelledAt),
				moves
			)
		);
	const deadlines = db
		.update(workOrder)
		.set({ dueAt: sql`${workOrder.dueAt} + (${deltaSeconds})`, updatedAt: new Date() })
		.where(
			and(
				eq(workOrder.eventId, eventId),
				inArray(workOrder.anchor, [...anchors]),
				isNotNull(workOrder.dueAt),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				moves
			)
		);
	return [shifts, deadlines] as const;
}

/**
 * Place the work stamped while its anchor had no time, now that it has one: a
 * task with a pending duration gets its shift, one without gets its deadline,
 * and both clear their pending offsets. Two statements for the caller's batch,
 * shift first, since it reads the offsets the second clears.
 */
export function placePendingWorkOrders(
	scope: { eventId: string } | { projectId: string },
	anchors: readonly DutyListAnchor[],
	atSeconds: SQL
) {
	const at = sql`(${atSeconds})`;
	const waiting = and(
		'eventId' in scope
			? eq(workOrder.eventId, scope.eventId)
			: eq(workOrder.projectId, scope.projectId),
		inArray(workOrder.anchor, [...anchors]),
		isNotNull(workOrder.pendingOffsetMinutes),
		isNull(workOrder.cancelledAt),
		isNull(workOrder.resolvedAt),
		sql`${at} is not null`
	);
	const now = Math.floor(Date.now() / 1000);
	const start = sql`${at} + ${workOrder.pendingOffsetMinutes} * 60`;

	// A UUID v4 in SQL, as the migrations that copy shifts make one.
	const uuid = sql`lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
		substr(lower(hex(randomblob(2))), 2) || '-' ||
		substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
		lower(hex(randomblob(6)))`;
	const shifts = db.run(sql`
		insert into ${volunteerShift}
			("id", "work_order_id", "starts_at", "ends_at", "capacity", "anchor",
			 "created_by_user_id", "created_at", "updated_at")
		select ${uuid}, ${workOrder.id}, ${start}, ${start} + ${workOrder.pendingDurationMinutes} * 60,
			coalesce(${workOrder.pendingCapacity}, 1), ${workOrder.anchor},
			${workOrder.createdByUserId}, ${now}, ${now}
		from ${workOrder}
		where ${and(waiting, isNotNull(workOrder.pendingDurationMinutes))}
	`);

	const windowed = sql`${workOrder.pendingDurationMinutes} is not null`;
	const tasks = db
		.update(workOrder)
		.set({
			dueAt: sql`case when ${windowed} then ${workOrder.dueAt} else ${start} end`,
			pendingOffsetMinutes: null,
			pendingDurationMinutes: null,
			pendingCapacity: null,
			updatedAt: new Date()
		})
		.where(waiting);
	return [shifts, tasks] as const;
}
