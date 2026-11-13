import { linkedIdSql, linkedTo } from '#lib/server/task/work-order-link.js';
import { db } from '#lib/server/db/index.js';
import { and, asc, eq, gte, isNull, lt, not, sql } from 'drizzle-orm';
import { volunteerShift, workOrder } from '#lib/server/db/schema/volunteer.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { claimedSql, liveShift } from './work-order-service';
import { holdsPracticeSpaceClearanceSql } from './practice-space-clearance';

/** The reads behind the two orientation reminders (#2567, #2569). */

export interface UnclaimedOrientation {
	workOrderId: string;
	startsAt: Date;
	endsAt: Date;
	memberName: string;
}

/**
 * Live orientation shifts starting in [from, to) with nobody holding a place:
 * no claimed, confirmed or completed sign-up on any live shift of the task.
 */
export async function listUnclaimedOrientationsBetween(
	from: Date,
	to: Date
): Promise<UnclaimedOrientation[]> {
	return db
		.select({
			workOrderId: workOrder.id,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			memberName: user.name
		})
		.from(workOrder)
		.innerJoin(volunteerShift, eq(volunteerShift.workOrderId, workOrder.id))
		.innerJoin(reservation, eq(reservation.id, linkedIdSql('reservationId')))
		.innerJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				eq(workOrder.isOrientation, true),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				liveShift(),
				gte(volunteerShift.startsAt, from),
				lt(volunteerShift.startsAt, to),
				sql`${claimedSql()} = 0`
			)
		)
		.orderBy(asc(volunteerShift.startsAt))
		.limit(100);
}

export interface FirstVisit {
	id: string;
	startsAt: Date;
	endsAt: Date;
	userId: string;
	userName: string;
	userEmail: string;
	/** The live orientation shift's start, when the booking has one. */
	tourStartsAt: Date | null;
}

/**
 * A member's own confirmed bookings starting in [from, to) while they hold no
 * Practice space clearance at `at`. Band, teaching and event bookings are not
 * a member's visit, the same split the booking notice makes.
 */
export async function listFirstVisitsBetween(
	from: Date,
	to: Date,
	at: Date = from
): Promise<FirstVisit[]> {
	const tour = db
		.select({ startsAt: sql`min(${volunteerShift.startsAt})` })
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.where(
			and(
				linkedTo('reservationId', reservation.id),
				eq(workOrder.isOrientation, true),
				isNull(workOrder.cancelledAt),
				liveShift()
			)
		);

	return db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			userId: reservation.createdByUserId,
			userName: user.name,
			userEmail: user.email,
			tourStartsAt: sql<Date | null>`(${tour})`.mapWith(volunteerShift.startsAt)
		})
		.from(reservation)
		.innerJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				eq(reservation.status, 'confirmed'),
				eq(reservation.bookerType, 'user'),
				gte(reservation.startsAt, from),
				lt(reservation.startsAt, to),
				not(holdsPracticeSpaceClearanceSql(reservation.createdByUserId, at))
			)
		)
		.limit(500);
}
