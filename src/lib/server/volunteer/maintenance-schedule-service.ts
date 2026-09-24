import { db } from '$lib/server/db';
import { maintenanceSchedule, volunteerRole, workOrder } from '$lib/server/db/schema/volunteer';
import { project } from '$lib/server/db/schema/project';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import {
	MAINTENANCE_INTERVAL_MAX_DAYS,
	VOLUNTEER_SHIFT_MAX_CAPACITY,
	VOLUNTEER_SHIFT_NOTES_MAX,
	VOLUNTEER_SHIFT_TITLE_MAX
} from '$lib/config';
import type { MaintenanceSchedule } from '$lib/server/db/schema/volunteer';

// Generate-on-close recurring work. Nothing here runs on a clock: the next
// occurrence is written in the same batch that closes the current one, so the
// open work order is the whole of the schedule's state.

const DAY_MS = 86_400_000;

export class MaintenanceScheduleError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

export class MaintenanceScheduleNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Recurring work not found');
	}
}

/** Measured from the close, so a late clean pushes the next one back rather than stacking it. */
export function nextDueAt(closedAt: Date, intervalDays: number): Date {
	return new Date(closedAt.getTime() + intervalDays * DAY_MS);
}

type OccurrenceSource = Pick<
	MaintenanceSchedule,
	'id' | 'name' | 'volunteerRoleId' | 'projectId' | 'notes' | 'capacity'
>;

function occurrenceValues(s: OccurrenceSource, dueAt: Date) {
	return {
		maintenanceScheduleId: s.id,
		title: s.name,
		volunteerRoleId: s.volunteerRoleId,
		projectId: s.projectId,
		notes: s.notes,
		capacity: s.capacity,
		startsAt: null,
		endsAt: null,
		dueAt
	};
}

/**
 * The insert that writes the next occurrence, for the caller to batch with its
 * close. A conflict on `uq_work_order_open_occurrence` is a no-op.
 */
export function nextOccurrenceInsert(
	s: OccurrenceSource & Pick<MaintenanceSchedule, 'intervalDays'>,
	closedAt: Date
) {
	return db
		.insert(workOrder)
		.values(occurrenceValues(s, nextDueAt(closedAt, s.intervalDays)))
		.onConflictDoNothing();
}

/** The schedule an occurrence belongs to, if it is still writing occurrences. */
export async function getLiveSchedule(id: string): Promise<MaintenanceSchedule | null> {
	const [row] = await db
		.select()
		.from(maintenanceSchedule)
		.where(and(eq(maintenanceSchedule.id, id), isNull(maintenanceSchedule.retiredAt)))
		.limit(1);
	return row ?? null;
}

function validName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new MaintenanceScheduleError('Give the recurring work a name.');
	if (trimmed.length > VOLUNTEER_SHIFT_TITLE_MAX) {
		throw new MaintenanceScheduleError(
			`Keep the name under ${VOLUNTEER_SHIFT_TITLE_MAX} characters.`
		);
	}
	return trimmed;
}

function validInterval(days: number): number {
	if (!Number.isInteger(days) || days < 1 || days > MAINTENANCE_INTERVAL_MAX_DAYS) {
		throw new MaintenanceScheduleError(`Repeat every 1 to ${MAINTENANCE_INTERVAL_MAX_DAYS} days.`);
	}
	return days;
}

function validCapacity(capacity: number): number {
	if (!Number.isInteger(capacity) || capacity < 1 || capacity > VOLUNTEER_SHIFT_MAX_CAPACITY) {
		throw new MaintenanceScheduleError(
			`Ask for between 1 and ${VOLUNTEER_SHIFT_MAX_CAPACITY} people.`
		);
	}
	return capacity;
}

function validNotes(notes?: string | null): string | null {
	const trimmed = notes?.trim() ?? '';
	if (trimmed.length > VOLUNTEER_SHIFT_NOTES_MAX) {
		throw new MaintenanceScheduleError(
			`Keep the notes under ${VOLUNTEER_SHIFT_NOTES_MAX} characters.`
		);
	}
	return trimmed || null;
}

/** The schedule and its first occurrence, written together so neither exists alone. */
export async function createMaintenanceSchedule(data: {
	name: string;
	volunteerRoleId: string;
	intervalDays: number;
	firstDueAt: Date;
	projectId?: string | null;
	notes?: string | null;
	capacity?: number;
	createdByUserId: string;
}): Promise<{ id: string }> {
	const name = validName(data.name);
	const intervalDays = validInterval(data.intervalDays);
	const capacity = validCapacity(data.capacity ?? 1);
	const notes = validNotes(data.notes);

	const [role] = await db
		.select({ id: volunteerRole.id, isActive: volunteerRole.isActive })
		.from(volunteerRole)
		.where(eq(volunteerRole.id, data.volunteerRoleId))
		.limit(1);
	if (!role) throw new MaintenanceScheduleError('That role no longer exists.');
	if (!role.isActive) {
		throw new MaintenanceScheduleError('That role is archived — restore it before assigning work.');
	}

	const row = {
		id: crypto.randomUUID(),
		name,
		volunteerRoleId: data.volunteerRoleId,
		projectId: data.projectId || null,
		notes,
		capacity,
		intervalDays,
		createdByUserId: data.createdByUserId
	};

	await db.batch([
		db.insert(maintenanceSchedule).values(row),
		db
			.insert(workOrder)
			.values({ ...occurrenceValues(row, data.firstDueAt), createdByUserId: data.createdByUserId })
	]);

	return { id: row.id };
}

/** Stops further occurrences. The open one stays: it is real work already queued. */
export async function retireMaintenanceSchedule(id: string): Promise<void> {
	const rows = await db
		.update(maintenanceSchedule)
		.set({ retiredAt: new Date(), updatedAt: new Date() })
		.where(and(eq(maintenanceSchedule.id, id), isNull(maintenanceSchedule.retiredAt)))
		.returning({ id: maintenanceSchedule.id });
	if (rows.length === 0) throw new MaintenanceScheduleNotFoundError();
}

export interface MaintenanceScheduleRow {
	id: string;
	name: string;
	intervalDays: number;
	capacity: number;
	retiredAt: Date | null;
	roleName: string;
	projectId: string | null;
	projectName: string | null;
	openWorkOrderId: string | null;
	openDueAt: Date | null;
	lastClosedAt: Date | null;
}

/** Every schedule with its open occurrence, live ones first. */
export async function listMaintenanceSchedules(): Promise<MaintenanceScheduleRow[]> {
	const rows = await db
		.select({
			id: maintenanceSchedule.id,
			name: maintenanceSchedule.name,
			intervalDays: maintenanceSchedule.intervalDays,
			capacity: maintenanceSchedule.capacity,
			retiredAt: maintenanceSchedule.retiredAt,
			roleName: volunteerRole.name,
			projectId: maintenanceSchedule.projectId,
			projectName: project.name,
			openWorkOrderId: workOrder.id,
			openDueAt: workOrder.dueAt,
			lastClosedAt: sql<number | null>`(
				select max(coalesce(wo."resolved_at", wo."cancelled_at")) from "work_order" wo
				where wo."maintenance_schedule_id" = ${maintenanceSchedule.id}
			)`
		})
		.from(maintenanceSchedule)
		.innerJoin(volunteerRole, eq(volunteerRole.id, maintenanceSchedule.volunteerRoleId))
		.leftJoin(project, eq(project.id, maintenanceSchedule.projectId))
		.leftJoin(
			workOrder,
			and(
				eq(workOrder.maintenanceScheduleId, maintenanceSchedule.id),
				isNull(workOrder.resolvedAt),
				isNull(workOrder.cancelledAt)
			)
		)
		.orderBy(
			sql`${maintenanceSchedule.retiredAt} is not null`,
			asc(workOrder.dueAt),
			asc(maintenanceSchedule.name)
		);

	return rows.map((r) => ({
		...r,
		lastClosedAt: r.lastClosedAt == null ? null : new Date(Number(r.lastClosedAt) * 1000)
	}));
}
