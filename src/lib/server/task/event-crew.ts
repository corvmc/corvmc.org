import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	volunteerRole,
	volunteerShift,
	volunteerSignup,
	workOrder
} from '#lib/server/db/schema/volunteer.js';
import { user } from '#lib/server/db/schema/authentication.js';

/**
 * The shifts on one event's own tasks, each with the people holding a place
 * on it: the rows of the event page's Crew box (#3270). Cancelled shifts and
 * shifts on called-off or finished tasks are left out; a cancelled or no-show
 * sign-up holds no place, so it names nobody.
 */

export interface CrewPerson {
	userId: string;
	name: string;
}

export interface CrewShift {
	shiftId: string;
	workOrderId: string;
	/** The task's title, else its role's name. */
	label: string;
	startsAt: Date;
	capacity: number;
	people: CrewPerson[];
}

const HOLDS_A_PLACE = ['claimed', 'confirmed', 'completed'] as const;

export async function eventCrew(eventId: string): Promise<CrewShift[]> {
	const shifts = await db
		.select({
			shiftId: volunteerShift.id,
			workOrderId: workOrder.id,
			title: workOrder.title,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			capacity: volunteerShift.capacity
		})
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(
			and(
				eq(workOrder.eventId, eventId),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt),
				isNull(volunteerShift.cancelledAt)
			)
		)
		.orderBy(asc(volunteerShift.startsAt), asc(volunteerShift.id));
	if (shifts.length === 0) return [];

	const signups = await db
		.select({ shiftId: volunteerSignup.shiftId, userId: user.id, name: user.name })
		.from(volunteerSignup)
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				inArray(
					volunteerSignup.shiftId,
					shifts.map((s) => s.shiftId)
				),
				inArray(volunteerSignup.status, [...HOLDS_A_PLACE])
			)
		)
		.orderBy(asc(volunteerSignup.createdAt), asc(volunteerSignup.id));

	return shifts.map(({ title, roleName, ...s }) => ({
		...s,
		label: title ?? roleName ?? '',
		people: signups
			.filter((p) => p.shiftId === s.shiftId)
			.map(({ userId, name }) => ({ userId, name }))
	}));
}
