import { db } from '#lib/server/db/index.js';
import {
	workOrder,
	volunteerShift,
	volunteerSignup,
	volunteerRole,
	workOrderAssignee
} from '#lib/server/db/schema/volunteer.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, asc, count, eq, getTableColumns, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DomainError } from '#lib/server/errors.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import {
	contractorJobStatusesWithoutSpend,
	DEFAULT_TIMEZONE,
	VOLUNTEER_SHIFT_MAX_CAPACITY,
	VOLUNTEER_SHIFT_MAX_MINUTES,
	VOLUNTEER_SHIFT_NOTES_MAX,
	VOLUNTEER_SHIFT_TITLE_MAX
} from '#lib/config.js';
import type {
	Task,
	VolunteerRoleGroup,
	VolunteerShift,
	WorkOrder,
	WorkOrderLegacyColumn
} from '#lib/server/db/schema/volunteer.js';
import { chunk } from '#lib/server/utils/chunk.js';
import { memberRefColumns, toMemberRef } from '#lib/server/entity/refs.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import type { WorkOrderField } from '#lib/types/audit.js';

import { getLiveSchedule, nextOccurrenceInsert } from './maintenance-schedule-service';

export { isScheduled } from './scheduled';
import { isScheduled } from './scheduled';

// ---------------------------------------------------------------------------
// Tasks and shifts (#2518)
// ---------------------------------------------------------------------------
// A task (`work_order`) is the work; a shift (`volunteer_shift`) is a time
// volunteers sign up for it. A task has zero or more shifts. Assignment is
// `work_order_assignee`, never a sign-up.
// ---------------------------------------------------------------------------

const TZ = DEFAULT_TIMEZONE;

export class ShiftNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Shift not found');
	}
}

export class ShiftValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

/** `YYYY-MM-DDTHH:mm` from a datetime-local input, read as club wall-clock time. */
export function parseLocal(value: string, label: string): Date {
	const [datePart, timePart] = value.split('T');
	if (!datePart || !timePart)
		throw new ShiftValidationError(`${label} is not a valid date and time`);
	return buildDateInTz(datePart, timePart, TZ);
}

interface ShiftTimes {
	startsAt: Date;
	endsAt: Date;
}

export function validateTimes(startsAt: Date, endsAt: Date): ShiftTimes {
	if (endsAt <= startsAt) {
		throw new ShiftValidationError('The shift has to end after it starts.');
	}
	const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
	if (minutes > VOLUNTEER_SHIFT_MAX_MINUTES) {
		throw new ShiftValidationError('That shift is longer than a day — check the end date.');
	}
	return { startsAt, endsAt };
}

export function validateCapacity(capacity: number): number {
	if (!Number.isInteger(capacity) || capacity < 1) {
		throw new ShiftValidationError('A shift needs at least one person.');
	}
	if (capacity > VOLUNTEER_SHIFT_MAX_CAPACITY) {
		throw new ShiftValidationError(
			`${VOLUNTEER_SHIFT_MAX_CAPACITY} is the most one shift can ask for.`
		);
	}
	return capacity;
}

export function validateTitle(title?: string | null): string | null {
	const trimmed = title?.trim() ?? '';
	if (trimmed.length > VOLUNTEER_SHIFT_TITLE_MAX) {
		throw new ShiftValidationError(`Keep the name under ${VOLUNTEER_SHIFT_TITLE_MAX} characters.`);
	}
	return trimmed || null;
}

function validateNotes(notes?: string | null): string | null {
	const trimmed = notes?.trim() ?? '';
	if (trimmed.length > VOLUNTEER_SHIFT_NOTES_MAX) {
		throw new ShiftValidationError(`Keep the notes under ${VOLUNTEER_SHIFT_NOTES_MAX} characters.`);
	}
	return trimmed || null;
}

/** A role work can be put under: it exists and is not archived. */
export async function requireActiveRole(volunteerRoleId: string): Promise<void> {
	const [role] = await db
		.select({ id: volunteerRole.id, isActive: volunteerRole.isActive })
		.from(volunteerRole)
		.where(eq(volunteerRole.id, volunteerRoleId))
		.limit(1);

	if (!role) throw new ShiftValidationError('That role no longer exists.');
	if (!role.isActive) {
		throw new ShiftValidationError('That role is archived — restore it before assigning work.');
	}
}

const LEGACY_COLUMNS: readonly WorkOrderLegacyColumn[] = [
	'legacyStartsAt',
	'legacyEndsAt',
	'legacyCapacity',
	'legacyPostedAt',
	'legacyPostedByUserId',
	'legacyCloseReportsOnCompletion'
];

/** A `work_order` row without the columns that moved to `volunteer_shift` or were retired. */
export function toTask(row: WorkOrder): Task {
	const task: Partial<WorkOrder> = { ...row };
	for (const column of LEGACY_COLUMNS) delete task[column];
	return task as Task;
}

/** `work_order`'s columns for a select, without the legacy ones. */
export function taskColumns() {
	const columns: Partial<ReturnType<typeof getTableColumns<typeof workOrder>>> = {
		...getTableColumns(workOrder)
	};
	for (const column of LEGACY_COLUMNS) delete columns[column];
	return columns as Omit<
		ReturnType<typeof getTableColumns<typeof workOrder>>,
		WorkOrderLegacyColumn
	>;
}

/** Not called off: what every forward-looking shift query reads. */
export const liveShift = () => isNull(volunteerShift.cancelledAt);

/** Open work: neither marked done nor called off. */
export const openTask = () => and(isNull(workOrder.resolvedAt), isNull(workOrder.cancelledAt));

/** Whether the task in scope has a shift that is not called off. */
export function hasLiveShiftSql() {
	return sql<number>`exists (
		select 1 from "volunteer_shift" s
		where s."work_order_id" = ${workOrder.id} and s."cancelled_at" is null
	)`;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * A new task with one shift on it: the schedule page's "new shift" form, which
 * names the role and the time together. The two rows are one `db.batch`.
 */
export async function createShift(data: {
	volunteerRoleId: string;
	eventId?: string | null;
	/** The inventory unit the work is about. Blank means none. */
	assetId?: string | null;
	/** What to call it, where the event does not. Blank falls back to the role. */
	title?: string | null;
	/** `YYYY-MM-DDTHH:mm`, club time. */
	startsAt: string;
	endsAt: string;
	capacity: number;
	notes?: string | null;
	createdByUserId: string;
}): Promise<Task & { shiftId: string }> {
	const [role] = await db
		.select({ id: volunteerRole.id, isActive: volunteerRole.isActive })
		.from(volunteerRole)
		.where(eq(volunteerRole.id, data.volunteerRoleId))
		.limit(1);

	if (!role) throw new ShiftValidationError('That role no longer exists.');
	if (!role.isActive) {
		throw new ShiftValidationError('That role is archived — restore it before scheduling shifts.');
	}

	const times = validateTimes(parseLocal(data.startsAt, 'Start'), parseLocal(data.endsAt, 'End'));
	const taskId = crypto.randomUUID();

	const [[task], [shift]] = await db.batch([
		db
			.insert(workOrder)
			.values({
				id: taskId,
				volunteerRoleId: data.volunteerRoleId,
				eventId: data.eventId || null,
				assetId: data.assetId || null,
				title: validateTitle(data.title),
				createdByUserId: data.createdByUserId
			})
			.returning(),
		db
			.insert(volunteerShift)
			.values({
				workOrderId: taskId,
				startsAt: times.startsAt,
				endsAt: times.endsAt,
				capacity: validateCapacity(data.capacity),
				notes: validateNotes(data.notes),
				createdByUserId: data.createdByUserId
			})
			.returning()
	]);

	return { ...toTask(task), shiftId: shift.id };
}

/**
 * Open a shift on a task: a time volunteers can sign up for. Creating it is what
 * puts it on the board. A task with a shift needs a role, which is cross-table,
 * so it is enforced here rather than by a CHECK.
 */
export async function openShift(
	workOrderId: string,
	data: {
		/** `YYYY-MM-DDTHH:mm`, club time. */
		startsAt: string;
		endsAt: string;
		capacity?: number;
		notes?: string | null;
		createdByUserId: string;
	}
): Promise<VolunteerShift> {
	const task = await getWorkOrderById(workOrderId);
	if (!task) throw new ShiftNotFoundError();
	if (task.resolvedAt) throw new ShiftValidationError('That task is already done.');
	if (task.cancelledAt) throw new ShiftValidationError('That task was called off.');
	if (!task.volunteerRoleId) {
		throw new ShiftValidationError('Give the task a volunteer role before opening a shift on it.');
	}
	await requireActiveRole(task.volunteerRoleId);

	const times = validateTimes(parseLocal(data.startsAt, 'Start'), parseLocal(data.endsAt, 'End'));
	const [shift] = await db
		.insert(volunteerShift)
		.values({
			workOrderId,
			startsAt: times.startsAt,
			endsAt: times.endsAt,
			capacity: validateCapacity(data.capacity ?? task.pendingCapacity ?? 1),
			notes: validateNotes(data.notes),
			anchor: task.anchor,
			createdByUserId: data.createdByUserId
		})
		.returning();

	await recordAuditEntry({
		action: 'work_order.rescheduled',
		subject: { type: 'work_order', id: task.id, label: workOrderAuditLabel(task) },
		details: {
			from: { startsAt: null, endsAt: null, dueAt: iso(task.dueAt) },
			to: { startsAt: iso(shift.startsAt), endsAt: iso(shift.endsAt), dueAt: iso(task.dueAt) }
		}
	});
	return shift;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** What an audit entry compares: the task, with its shift's times and places. */
export type WorkOrderAuditView = Pick<
	Task,
	'id' | 'title' | 'dueAt' | 'volunteerRoleId' | 'notes' | 'eventId' | 'assetId'
> & { startsAt?: Date | null; endsAt?: Date | null; capacity?: number | null };

function auditView(task: Task, shift: VolunteerShift | null): WorkOrderAuditView {
	return {
		...task,
		startsAt: shift?.startsAt ?? null,
		endsAt: shift?.endsAt ?? null,
		capacity: shift?.capacity ?? null,
		notes: shift?.notes ?? task.notes
	};
}

const timing = (w: WorkOrderAuditView) => ({
	startsAt: iso(w.startsAt),
	endsAt: iso(w.endsAt),
	dueAt: iso(w.dueAt)
});

/** The label an entry keeps if the work order is later renamed or gone. */
export const workOrderAuditLabel = (w: Pick<Task, 'id' | 'title'>) => w.title ?? w.id;

/**
 * Record what an edit changed: a new time as `.rescheduled`, anything else as
 * `.edited` by field name. Every path that edits a work order calls this, so
 * the shift page and the project page write the same entries.
 */
export async function auditWorkOrderChange(
	before: WorkOrderAuditView,
	after: WorkOrderAuditView
): Promise<void> {
	const subject = { type: 'work_order' as const, id: after.id, label: workOrderAuditLabel(after) };
	const [from, to] = [timing(before), timing(after)];
	if (from.startsAt !== to.startsAt || from.endsAt !== to.endsAt || from.dueAt !== to.dueAt) {
		await recordAuditEntry({ action: 'work_order.rescheduled', subject, details: { from, to } });
	}
	const changed: [WorkOrderField, unknown, unknown][] = [
		['role', before.volunteerRoleId, after.volunteerRoleId],
		['title', before.title, after.title],
		['capacity', before.capacity, after.capacity],
		['notes', before.notes, after.notes],
		['event', before.eventId, after.eventId],
		['equipment', before.assetId, after.assetId]
	];
	const fields = changed.filter(([, a, b]) => (a ?? null) !== (b ?? null)).map(([f]) => f);
	if (fields.length > 0) {
		await recordAuditEntry({ action: 'work_order.edited', subject, details: { fields } });
	}
}

/** Call off a task's live shifts, as a statement for the caller's batch. */
export function cancelLiveShifts(workOrderId: string, cancelledByUserId: string | null, at: Date) {
	return db
		.update(volunteerShift)
		.set({ cancelledAt: at, cancelledByUserId, updatedAt: at })
		.where(and(eq(volunteerShift.workOrderId, workOrderId), liveShift()));
}

/**
 * Call off a task and every live shift on it. The rows and their sign-ups stay:
 * people on the shifts still need telling, and "we cancelled that one" is worth
 * being able to see.
 *
 * `cancelledByUserId` is what lets the cancelled task say who called it off.
 * Optional so a sweep has no user to invent; every staff path passes one.
 */
export async function cancelShift(id: string, cancelledByUserId?: string): Promise<Task> {
	const now = new Date();
	const by = cancelledByUserId ?? null;
	const cancel = db
		.update(workOrder)
		.set({ cancelledAt: now, cancelledByUserId: by, updatedAt: now })
		.where(and(eq(workOrder.id, id), isNull(workOrder.cancelledAt)))
		.returning();

	// Calling off a recurring occurrence is still a close: the next one is owed.
	const schedule = await liveScheduleOf(await getWorkOrderById(id));
	const [[row]] = schedule
		? await db.batch([cancel, cancelLiveShifts(id, by, now), nextOccurrenceInsert(schedule, now)])
		: await db.batch([cancel, cancelLiveShifts(id, by, now)]);

	if (!row) throw new ShiftNotFoundError();
	await recordAuditEntry({
		action: 'work_order.cancelled',
		subject: { type: 'work_order', id: row.id, label: workOrderAuditLabel(row) },
		details: {}
	});
	return toTask(row);
}

/** A shift that can still be changed: it exists, it is live, and its task is open. */
async function requireEditableShift(shiftId: string) {
	const shift = await getShiftById(shiftId);
	if (!shift) throw new ShiftNotFoundError();
	if (shift.cancelledAt) throw new ShiftValidationError('That shift was called off.');
	if (shift.taskResolvedAt) throw new ShiftValidationError('That task is already done.');
	if (shift.taskCancelledAt) throw new ShiftValidationError('That task was called off.');
	const task = await getWorkOrderById(shift.workOrderId);
	if (!task) throw new ShiftNotFoundError();
	return { shift, task };
}

/**
 * Edit the task alone: its role, show, unit, name and notes. Times and places
 * are each shift's (`editShift`), so nothing here moves a shift.
 */
export async function editTask(
	id: string,
	data: {
		volunteerRoleId?: string;
		eventId?: string | null;
		assetId?: string | null;
		title?: string | null;
		notes?: string | null;
	}
): Promise<Task> {
	const existing = await getWorkOrderById(id);
	if (!existing) throw new ShiftNotFoundError();
	if (data.volunteerRoleId && data.volunteerRoleId !== existing.volunteerRoleId) {
		await requireActiveRole(data.volunteerRoleId);
	}
	const [row] = await db
		.update(workOrder)
		.set({
			...(data.volunteerRoleId ? { volunteerRoleId: data.volunteerRoleId } : {}),
			...(data.eventId !== undefined ? { eventId: data.eventId || null } : {}),
			...(data.assetId !== undefined ? { assetId: data.assetId || null } : {}),
			...(data.title !== undefined ? { title: validateTitle(data.title) } : {}),
			...(data.notes !== undefined ? { notes: validateNotes(data.notes) } : {}),
			updatedAt: new Date()
		})
		.where(eq(workOrder.id, id))
		.returning();
	const task = toTask(row);
	await auditWorkOrderChange(existing, task);
	return task;
}

/**
 * Edit one shift: its times, places and briefing. Refuses fewer places than are
 * already taken, which would leave people on a shift with no room for them.
 */
export async function editShift(
	shiftId: string,
	data: { startsAt?: string; endsAt?: string; capacity?: number; notes?: string | null }
): Promise<VolunteerShift> {
	const { shift, task } = await requireEditableShift(shiftId);
	const times = validateTimes(
		data.startsAt ? parseLocal(data.startsAt, 'Start') : shift.startsAt,
		data.endsAt ? parseLocal(data.endsAt, 'End') : shift.endsAt
	);
	if (data.capacity !== undefined) {
		validateCapacity(data.capacity);
		const claimed = await countActiveSignups(shift.id);
		if (data.capacity < claimed) {
			throw new ShiftValidationError(
				`${claimed} ${claimed === 1 ? 'person has' : 'people have'} already signed up. ` +
					`Take someone off before reducing it below ${claimed}.`
			);
		}
	}
	const [row] = await db
		.update(volunteerShift)
		.set({
			startsAt: times.startsAt,
			endsAt: times.endsAt,
			...(data.capacity !== undefined ? { capacity: data.capacity } : {}),
			...(data.notes !== undefined ? { notes: validateNotes(data.notes) } : {}),
			updatedAt: new Date()
		})
		.where(eq(volunteerShift.id, shift.id))
		.returning();
	await auditWorkOrderChange(auditView(task, shift), auditView(task, row));
	return row;
}

/**
 * Call off one shift and leave its task open. Its sign-ups stay, as a list of
 * people still to tell; calling off the task is `cancelShift`.
 */
export async function cancelOneShift(
	shiftId: string,
	cancelledByUserId: string
): Promise<VolunteerShift> {
	const { shift, task } = await requireEditableShift(shiftId);
	const now = new Date();
	const [row] = await db
		.update(volunteerShift)
		.set({ cancelledAt: now, cancelledByUserId, updatedAt: now })
		.where(and(eq(volunteerShift.id, shift.id), liveShift()))
		.returning();
	if (!row) throw new ShiftNotFoundError();
	await recordAuditEntry({
		action: 'work_order.rescheduled',
		subject: { type: 'work_order', id: task.id, label: workOrderAuditLabel(task) },
		details: {
			from: { startsAt: iso(shift.startsAt), endsAt: iso(shift.endsAt), dueAt: iso(task.dueAt) },
			to: { startsAt: null, endsAt: null, dueAt: iso(task.dueAt) }
		}
	});
	return row;
}

/**
 * Copy a shift forward onto the same task, N days later by the club's clock.
 * A standing slot is one task with a shift per week, so its checklist, reports
 * and assignees stay in one place. Nobody on the original is copied.
 */
export async function copyShiftForward(
	shiftId: string,
	offsetDays: number,
	createdByUserId: string
): Promise<VolunteerShift> {
	const shift = await getShiftById(shiftId);
	if (!shift) throw new ShiftNotFoundError();
	if (shift.taskResolvedAt) throw new ShiftValidationError('That task is already done.');
	if (shift.taskCancelledAt) throw new ShiftValidationError('That task was called off.');
	if (!Number.isInteger(offsetDays) || offsetDays < 1 || offsetDays > 365) {
		throw new ShiftValidationError('Copy it somewhere between tomorrow and a year out.');
	}
	const startsAt = moveLocalDate(shift.startsAt, offsetDays);
	const endsAt = moveLocalDate(shift.endsAt, offsetDays);
	if (endsAt < new Date()) {
		throw new ShiftValidationError(
			'That copy would land in the past. Pick an offset that reaches a future date.'
		);
	}
	const [copy] = await db
		.insert(volunteerShift)
		.values({
			workOrderId: shift.workOrderId,
			startsAt,
			endsAt,
			capacity: shift.capacity,
			notes: shift.notes,
			createdByUserId
		})
		.returning();
	return copy;
}

/**
 * Move an instant by whole days of wall-clock time, not by milliseconds: adding
 * 7 × 86,400,000 ms across a DST boundary moves a 6pm shift to 5pm or 7pm.
 */
function moveLocalDate(d: Date, days: number): Date {
	const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
	const hm = new Intl.DateTimeFormat('en-GB', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(d);
	const [y, m, day] = ymd.split('-').map(Number);
	const moved = new Date(Date.UTC(y, m - 1, day + days));
	return buildDateInTz(moved.toISOString().slice(0, 10), hm, TZ);
}

/** One shift of a task, with its counts and who called it off. */
export interface TaskShift extends VolunteerShift {
	claimed: number;
	confirmed: number;
	unnotified: number;
	cancelledByName: string | null;
}

/** Every shift on a task, earliest first, live and called off alike. */
export async function listTaskShifts(workOrderId: string): Promise<TaskShift[]> {
	const rows = await db
		.select({
			shift: volunteerShift,
			claimed: shiftClaimedSql(),
			confirmed: shiftConfirmedSql(),
			unnotified: shiftUnnotifiedSql(),
			cancelledByName: user.name
		})
		.from(volunteerShift)
		.leftJoin(user, eq(user.id, volunteerShift.cancelledByUserId))
		.where(eq(volunteerShift.workOrderId, workOrderId))
		.orderBy(asc(volunteerShift.startsAt), asc(volunteerShift.id));
	return rows.map((r) => ({
		...r.shift,
		claimed: Number(r.claimed),
		confirmed: Number(r.confirmed),
		unnotified: Number(r.unnotified),
		cancelledByName: r.cancelledByName
	}));
}

/** The schedule to write a next occurrence for, when closing this row owes one. */
async function liveScheduleOf(row: Task | null) {
	if (!row?.maintenanceScheduleId || row.resolvedAt || row.cancelledAt) return null;
	return getLiveSchedule(row.maintenanceScheduleId);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getWorkOrderById(id: string): Promise<Task | null> {
	const [row] = await db.select().from(workOrder).where(eq(workOrder.id, id)).limit(1);
	return row ? toTask(row) : null;
}

/** A shift with the facts about its task that sign-ups branch on. */
export interface ShiftRecord extends VolunteerShift {
	volunteerRoleId: string | null;
	title: string | null;
	eventId: string | null;
	taskCancelledAt: Date | null;
	taskResolvedAt: Date | null;
}

export async function getShiftById(id: string): Promise<ShiftRecord | null> {
	const [row] = await db
		.select({
			shift: volunteerShift,
			volunteerRoleId: workOrder.volunteerRoleId,
			title: workOrder.title,
			eventId: workOrder.eventId,
			taskCancelledAt: workOrder.cancelledAt,
			taskResolvedAt: workOrder.resolvedAt
		})
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.where(eq(volunteerShift.id, id))
		.limit(1);
	if (!row) return null;
	const { shift, ...task } = row;
	return { ...shift, ...task };
}

/**
 * Not on a cancelled listing. A backstop behind the cascade in `show-cancellation`,
 * for work orders on a show that was cancelled before the cascade existed.
 */
export function notOnCancelledListing() {
	return sql`not exists (
		select 1 from "event_listing" e
		where e."id" = ${workOrder.eventId} and e."status" = 'cancelled'
	)`;
}

/** Claims that still hold a place — cancelled and no-show ones free their slot. */
const ACTIVE_SIGNUP_STATUSES = ['claimed', 'confirmed', 'completed'] as const;

const holdsAPlace = () =>
	sql.join(
		ACTIVE_SIGNUP_STATUSES.map((status) => sql`${status}`),
		sql`, `
	);

export async function countActiveSignups(shiftId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(volunteerSignup)
		.where(
			and(
				eq(volunteerSignup.shiftId, shiftId),
				inArray(volunteerSignup.status, [...ACTIVE_SIGNUP_STATUSES])
			)
		);
	return Number(row?.n ?? 0);
}

/** A `ShiftWithCounts` some date filter has already narrowed. See `isScheduled`. */
export type ScheduledShiftWithCounts = ShiftWithCounts & { startsAt: Date; endsAt: Date };

/**
 * A task as a staff list row, with one of its shifts. `id` is the task's;
 * `shiftId` names the shift whose times, places and roster the row shows, and is
 * null on a task with no shift.
 */
export interface ShiftWithCounts extends Task {
	shiftId: string | null;
	startsAt: Date | null;
	endsAt: Date | null;
	/** The shift's places; 1 on a task with no shift. */
	capacity: number;
	/** Null on a contractor's or not-yet-assigned work order: the role join is a left join. */
	roleName: string | null;
	roleGroup: VolunteerRoleGroup | null;
	eventTitle: string | null;
	/** The linked inventory unit as a label: item name, plus its tag. */
	assetName?: string | null;
	/** Places taken: claimed + confirmed + completed. */
	claimed: number;
	/**
	 * How many of those places are actually booked. Only a confirmed sign-up gets
	 * the day-before reminder, so 3/3 with none confirmed is not staffed.
	 */
	confirmed: number;
	/** People on a called-off shift who still have to be told. Zero while it is live. */
	unnotified: number;
	/** People assigned the task (`work_order_assignee`), apart from any shift. */
	assignees: number;
}

type ShiftRowSource = {
	task: WorkOrder;
	shift: VolunteerShift | null;
	roleName: string | null;
	roleGroup: VolunteerRoleGroup | null;
	eventTitle: string | null;
	assetName: string | null;
	claimed: number;
	confirmed: number;
	unnotified: number;
	assignees: number;
};

function withCounts(rows: ShiftRowSource[]): ShiftWithCounts[] {
	return rows.map(({ task, shift, ...r }) => ({
		...toTask(task),
		shiftId: shift?.id ?? null,
		startsAt: shift?.startsAt ?? null,
		endsAt: shift?.endsAt ?? null,
		capacity: shift?.capacity ?? 1,
		notes: shift?.notes ?? task.notes,
		anchor: shift?.anchor ?? task.anchor,
		cancelledAt: task.cancelledAt ?? shift?.cancelledAt ?? null,
		cancelledByUserId: task.cancelledAt
			? task.cancelledByUserId
			: (shift?.cancelledByUserId ?? null),
		roleName: r.roleName,
		roleGroup: r.roleGroup,
		eventTitle: r.eventTitle,
		assetName: r.assetName,
		claimed: Number(r.claimed),
		confirmed: Number(r.confirmed),
		unnotified: Number(r.unnotified),
		assignees: Number(r.assignees)
	}));
}

/** Places taken on the shift in scope. */
export function shiftClaimedSql() {
	return sql<number>`(
		select count(*) from "volunteer_signup" vs
		where vs."shift_id" = ${volunteerShift.id}
			and vs."status" in (${holdsAPlace()})
	)`;
}

/**
 * Places taken across the live shifts of the task in scope. Built from
 * ACTIVE_SIGNUP_STATUSES so a new status that holds a place can't quietly stop
 * counting.
 */
export function claimedSql() {
	return sql<number>`(
		select count(*) from "volunteer_signup" vs
		join "volunteer_shift" s on s."id" = vs."shift_id"
		where s."work_order_id" = ${workOrder.id}
			and s."cancelled_at" is null
			and vs."status" in (${holdsAPlace()})
	)`;
}

/** Places across the live shifts of the task in scope; 0 with no shift. */
export function capacitySql() {
	return sql<number>`(
		select coalesce(sum(s."capacity"), 0) from "volunteer_shift" s
		where s."work_order_id" = ${workOrder.id} and s."cancelled_at" is null
	)`;
}

/** How many people are assigned the task in scope. */
export function assigneeCountSql() {
	return sql<number>`(
		select count(*) from "work_order_assignee" a where a."work_order_id" = ${workOrder.id}
	)`;
}

/**
 * The shows among these with a live crew shift still short of its places: what
 * `shifts_filled` asks. Committee-owned work is not crew.
 */
export async function eventsShortOfCrew(eventIds: string[]): Promise<Set<string>> {
	if (eventIds.length === 0) return new Set();
	const rows = await db
		.selectDistinct({ eventId: workOrder.eventId })
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.where(
			and(
				inArray(workOrder.eventId, eventIds),
				isNull(workOrder.groupId),
				isNull(workOrder.cancelledAt),
				liveShift(),
				sql`${shiftClaimedSql()} < ${volunteerShift.capacity}`
			)
		);
	return new Set(rows.map((r) => r.eventId!));
}

/**
 * Upcoming shifts still short of places, per role — the "what needs attention"
 * column on the staff roles table. Only roles with a short shift come back.
 * Past and cancelled shifts are out: nobody can still fill them.
 */
export async function countUnfilledByRole(from = new Date()): Promise<Map<string, number>> {
	const rows = await db
		.select({
			volunteerRoleId: workOrder.volunteerRoleId,
			unfilled: count()
		})
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.where(
			and(
				liveShift(),
				isNull(workOrder.cancelledAt),
				gte(volunteerShift.startsAt, from),
				sql`${shiftClaimedSql()} < ${volunteerShift.capacity}`
			)
		)
		.groupBy(workOrder.volunteerRoleId);

	// Work with no role has no claimants to be short of; it belongs to no role's count.
	return new Map(
		rows.flatMap((r) => (r.volunteerRoleId ? [[r.volunteerRoleId, Number(r.unfilled)]] : []))
	);
}

/**
 * The columns every staff row wants: the task, the shift, the role's name, the
 * show's title, and the shift's counts. The role and event joins are left joins
 * because both are nullable by design.
 */
function rowColumns() {
	return {
		task: workOrder,
		shift: volunteerShift,
		roleName: volunteerRole.name,
		roleGroup: volunteerRole.group,
		eventTitle: eventListing.title,
		assetName: sql<string | null>`(
			select ii."name" || coalesce(' · ' || ia."asset_tag", '') from "inventory_asset" ia
			join "inventory_item" ii on ii."id" = ia."item_id"
			where ia."id" = ${workOrder.assetId}
		)`,
		claimed: shiftClaimedSql(),
		confirmed: shiftConfirmedSql(),
		unnotified: shiftUnnotifiedSql(),
		assignees: assigneeCountSql()
	};
}

/**
 * Booked places on the shift in scope. `completed` counts: the completion sweep
 * only promotes a booked sign-up, so leaving it out makes every past shift unconfirmed.
 */
function shiftConfirmedSql() {
	return sql<number>`(
		select count(*) from "volunteer_signup" vs
		where vs."shift_id" = ${volunteerShift.id}
			and vs."status" in ('confirmed', 'completed')
	)`;
}

/** People on the shift in scope who have not been told it was called off. */
function shiftUnnotifiedSql() {
	return sql<number>`(
		select count(*) from "volunteer_signup" vs
		where vs."shift_id" = ${volunteerShift.id}
			and vs."status" <> 'cancelled'
			and vs."notified_at" is null
	)`;
}

/** One row per shift, with its task. */
function shiftRowsQuery() {
	return db
		.select(rowColumns())
		.from(workOrder)
		.innerJoin(volunteerShift, eq(volunteerShift.workOrderId, workOrder.id))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId));
}

/** One row per task, with its latest live shift (else its latest) when it has one. */
function taskRowsQuery() {
	const current = sql`${volunteerShift.id} = (
		select s2."id" from "volunteer_shift" s2
		where s2."work_order_id" = ${workOrder.id}
		order by s2."cancelled_at" is not null, s2."starts_at" desc
		limit 1
	)`;
	return db
		.select(rowColumns())
		.from(workOrder)
		.leftJoin(volunteerShift, current)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId));
}

/**
 * Create a task with no shift: work that needs doing, with nobody booked to do
 * it. Staff-created: a member's `work_request` reaches one of these through a
 * coordinator. Without a role it is a line typed into a project's list, and its
 * title is all it has.
 */
export async function createWorkOrder(data: {
	volunteerRoleId?: string | null;
	title?: string | null;
	assetId?: string | null;
	projectId?: string | null;
	/** Only meaningful with a project. */
	sectionId?: string | null;
	sortOrder?: number;
	notes?: string | null;
	/** A deadline, not a shift. */
	dueAt?: Date | null;
	/** Places for a shift opened on it later (`pendingCapacity`). */
	capacity?: number;
	createdByUserId: string;
}): Promise<Task> {
	const roleId = data.volunteerRoleId || null;
	const title = validateTitle(data.title);
	if (roleId) await requireActiveRole(roleId);
	else if (!title) throw new ShiftValidationError('Give the task a title.');

	const [row] = await db
		.insert(workOrder)
		.values({
			volunteerRoleId: roleId,
			title,
			assetId: data.assetId || null,
			projectId: data.projectId || null,
			sectionId: data.projectId ? data.sectionId || null : null,
			sortOrder: data.sortOrder ?? 0,
			dueAt: data.dueAt ?? null,
			pendingCapacity: data.capacity ? validateCapacity(data.capacity) : null,
			notes: data.notes ? validateNotes(data.notes) : null,
			createdByUserId: data.createdByUserId
		})
		.returning();

	return toTask(row);
}

export interface ResolveWorkOrderOptions {
	resolvedByUserId: string;
	notes?: string | null;
	/** The reason when the caller's own record is it, e.g. a completed contractor job. */
	recordReason?: string;
}

/**
 * Mark a task done, which is not the same as anybody having turned up: a shift
 * can end with the amp still broken, so closure lives on the task. Stamps every
 * assignee's `completed_at` and resolves the attached equipment reports.
 * Sign-ups are the completion cron's, by their shift's end. Does not touch the asset.
 */
export async function resolveWorkOrder(id: string, opts: ResolveWorkOrderOptions): Promise<Task> {
	const resolution = await prepareResolveWorkOrder(id, opts);
	const [, [row]] = await db.batch(resolution.statements);
	await resolution.afterCommit();
	return toTask(row);
}

/**
 * `resolveWorkOrder` in two halves, for a caller that commits the close in its
 * own `db.batch`: the checks and `statements` (the closing update second), and
 * `afterCommit` — the audit row and the domains that follow a resolution — to
 * run once that batch has landed.
 */
export async function prepareResolveWorkOrder(id: string, opts: ResolveWorkOrderOptions) {
	const existing = await getWorkOrderById(id);
	if (!existing) throw new ShiftNotFoundError();
	if (existing.resolvedAt) throw new ShiftValidationError('That is already closed.');
	if (existing.cancelledAt) throw new ShiftValidationError('That was called off.');

	// A done condition makes this the app's to close, so closing it by hand is an
	// override on every path: it carries a reason and is audited as one.
	const override = existing.doneWhen !== null;
	const notes = opts.notes?.trim() || (override ? opts.recordReason?.trim() : null) || null;
	if (override && !notes) {
		throw new ShiftValidationError(
			'This one ticks itself when its condition holds. Say why it is done regardless.'
		);
	}

	const now = new Date();

	// The assignees' prompt to log hours for the work.
	const completeAssignees = db
		.update(workOrderAssignee)
		.set({ completedAt: now })
		.where(and(eq(workOrderAssignee.workOrderId, id), isNull(workOrderAssignee.completedAt)));

	const close = db
		.update(workOrder)
		.set({
			resolvedAt: now,
			resolvedByUserId: opts.resolvedByUserId,
			resolutionNotes: notes,
			updatedAt: now
		})
		.where(eq(workOrder.id, id))
		.returning();

	const schedule = await liveScheduleOf(existing);
	const statements = schedule
		? ([completeAssignees, close, nextOccurrenceInsert(schedule, now)] as const)
		: ([completeAssignees, close] as const);

	async function afterCommit() {
		await recordAuditEntry({
			action: 'work_order.resolved',
			subject: { type: 'work_order', id, label: workOrderAuditLabel(existing!) },
			details: { override, reason: notes }
		});

		// The equipment reports this work answered close with it, and only here:
		// a shift ending never closes one (#2518). Dynamic, like the orientation
		// import below, so the two domains do not import each other.
		const { resolveFlagsForWorkOrder } = await import('../inventory/work-request-service');
		await resolveFlagsForWorkOrder(id, opts.resolvedByUserId, notes ?? undefined);

		// Staff marking an orientation done is the other way one gets finished; the
		// cron path emits `volunteer.shift_completed` per sign-up instead.
		// `completeOrientation` is `where completed_at is null`, so the two racing is a no-op.
		const { completeOrientation, orientationOwnerOf } = await import('./orientation-service');
		const member = await orientationOwnerOf(id);
		if (member) {
			await completeOrientation(member.userId, { completedByUserId: opts.resolvedByUserId });
		}
	}

	return { statements, afterCommit };
}

/**
 * Open tasks with a live shift and none still to finish: someone marks the task
 * done or opens another shift. The clock never closes a task (#2518).
 */
export function tasksWithEndedShiftsWhere(now: Date) {
	const nowSeconds = Math.floor(now.getTime() / 1000);
	return and(
		openTask(),
		hasLiveShiftSql(),
		sql`not exists (
			select 1 from "volunteer_shift" s
			where s."work_order_id" = ${workOrder.id}
				and s."cancelled_at" is null
				and s."ends_at" > ${nowSeconds}
		)`
	);
}

export interface WorkOrderQueueFilters {
	volunteerRoleId?: string;
	eventId?: string;
	projectId?: string;
}

/**
 * Open tasks with no live shift. Shared with `countVolunteerWorkWaiting`, so the
 * badge can only count rows this queue lists (#1828).
 */
export function unscheduledWorkWhere(filters: WorkOrderQueueFilters = {}) {
	return and(
		sql`not ${hasLiveShiftSql()}`,
		openTask(),
		// The same optional anchors `listShifts` takes: the advance half of a duty
		// list lands here carrying the event it is for.
		filters.volunteerRoleId ? eq(workOrder.volunteerRoleId, filters.volunteerRoleId) : undefined,
		filters.eventId ? eq(workOrder.eventId, filters.eventId) : undefined,
		filters.projectId ? eq(workOrder.projectId, filters.projectId) : undefined,
		// Unanchored, this is the coordinator's queue, and a committee's items
		// are on that committee's queue instead: nine a show would bury it. Work
		// with no role is a contractor's or nobody's yet, not volunteer work to time.
		filters.eventId || filters.projectId
			? undefined
			: and(isNull(workOrder.groupId), sql`${workOrder.volunteerRoleId} is not null`)
	);
}

/**
 * Unassigned tasks: open, with no live shift and nobody assigned. The Schedule's
 * chip and the staff badge both read this, so they cannot disagree (#1828).
 */
export function unassignedTaskWhere(filters: WorkOrderQueueFilters = {}) {
	return and(unscheduledWorkWhere(filters), sql`${assigneeCountSql()} = 0`);
}

/**
 * The coordinator's queue: work nobody has found a time for. Oldest first, like
 * every queue in this app.
 */
export async function listWorkOrders(
	filters: WorkOrderQueueFilters = {}
): Promise<ShiftWithCounts[]> {
	const rows = await taskRowsQuery()
		.where(unscheduledWorkWhere(filters))
		.orderBy(asc(workOrder.createdAt), asc(workOrder.id));

	return withCounts(rows);
}

/** Shifts by date, one row each, with their tasks. Tasks with no shift are `listWorkOrders`. */
export async function listShifts(
	filters: {
		volunteerRoleId?: string;
		eventId?: string;
		from?: Date;
		to?: Date;
		includeCancelled?: boolean;
	} = {}
): Promise<ScheduledShiftWithCounts[]> {
	const rows = await shiftRowsQuery()
		.where(
			and(
				filters.includeCancelled ? undefined : and(liveShift(), isNull(workOrder.cancelledAt)),
				filters.volunteerRoleId
					? eq(workOrder.volunteerRoleId, filters.volunteerRoleId)
					: undefined,
				filters.eventId ? eq(workOrder.eventId, filters.eventId) : undefined,
				filters.from ? gte(volunteerShift.startsAt, filters.from) : undefined,
				filters.to ? lte(volunteerShift.startsAt, filters.to) : undefined
			)
		)
		.orderBy(asc(volunteerShift.startsAt));

	return withCounts(rows).filter(isScheduled);
}

/** These tasks as list rows, whatever their state; the caller picked them. */
export async function listWorkOrdersByIds(ids: string[]): Promise<ShiftWithCounts[]> {
	if (ids.length === 0) return [];
	const rows = await taskRowsQuery()
		.where(inArray(workOrder.id, ids))
		.orderBy(asc(volunteerShift.startsAt), asc(workOrder.createdAt), asc(workOrder.id));
	return withCounts(rows);
}

/**
 * One task, with the same trimmings as a list row and its current shift.
 * Cancelled tasks are included — the detail page is where you go to find out
 * what was called off.
 */
export async function getShiftDetail(id: string): Promise<ShiftWithCounts | null> {
	const rows = await taskRowsQuery().where(eq(workOrder.id, id)).limit(1);
	return withCounts(rows)[0] ?? null;
}

/** Who called a task off, by name. Only one page asks, so it is not on the row query. */
export async function getShiftCancelledByName(workOrderId: string): Promise<string | null> {
	const [row] = await db
		.select({ name: user.name })
		.from(workOrder)
		.innerJoin(user, eq(user.id, workOrder.cancelledByUserId))
		.where(eq(workOrder.id, workOrderId))
		.limit(1);
	return row?.name ?? null;
}

/** Who is assigned a task, in the order they were assigned. */
export async function listWorkOrderAssignees(workOrderId: string) {
	const rows = await db
		.select({
			userId: workOrderAssignee.userId,
			member: memberRefColumns(),
			assignedAt: workOrderAssignee.assignedAt,
			completedAt: workOrderAssignee.completedAt
		})
		.from(workOrderAssignee)
		.innerJoin(user, eq(user.id, workOrderAssignee.userId))
		.where(eq(workOrderAssignee.workOrderId, workOrderId))
		.orderBy(asc(workOrderAssignee.assignedAt), asc(user.name));
	return rows.map((r) => ({ ...r, member: toMemberRef(r.member) }));
}

/** The task a shift is on, or `undefined` when there is no such shift. */
export async function workOrderIdOfShift(shiftId: string): Promise<string | undefined> {
	const [row] = await db
		.select({ workOrderId: volunteerShift.workOrderId })
		.from(volunteerShift)
		.where(eq(volunteerShift.id, shiftId))
		.limit(1);
	return row?.workOrderId;
}

/** The project a work order is on, or `undefined` when there is no such work order. */
export async function workOrderProjectId(id: string): Promise<string | null | undefined> {
	const [row] = await db
		.select({ projectId: workOrder.projectId })
		.from(workOrder)
		.where(eq(workOrder.id, id))
		.limit(1);
	return row ? row.projectId : undefined;
}

/**
 * A shift on the member board. `id` is the shift's (what a sign-up names);
 * `workOrderId` is its task's.
 */
export interface OpenShift extends Omit<Task, 'volunteerRoleId'> {
	workOrderId: string;
	startsAt: Date;
	endsAt: Date;
	capacity: number;
	volunteerRoleId: string;
	roleName: string;
	roleGroup: VolunteerRoleGroup;
	eventTitle: string | null;
	claimed: number;
	confirmed: number;
	/** This member's own sign-up, if they have a live one. */
	myStatus: string | null;
	mySignupId: string | null;
	/** Empty when they can claim it. */
	missingCertifications: { id: string; name: string }[];
	isFull: boolean;
	interested: boolean;
}

/** Kept for callers that named the narrowed type; every board shift has times. */
export type ScheduledOpenShift = OpenShift;

/**
 * What a member sees: upcoming live shifts on open tasks, including ones they
 * can't take — the reason tells them what to go and get. Their own sign-ups
 * first, then roles they said they'd help with.
 */
export async function listOpenShiftsForMember(
	userId: string,
	opts: { limit?: number } = {}
): Promise<Omit<OpenShift, 'missingCertifications'>[]> {
	const now = new Date();

	// Built once and reused in the select list and the ORDER BY: re-sorting in JS
	// after the LIMIT would drop a member's own shift off a busy board.
	const myStatusSql = sql<string | null>`(
		select vs."status" from "volunteer_signup" vs
		where vs."shift_id" = ${volunteerShift.id} and vs."user_id" = ${userId}
			and vs."status" != 'cancelled'
	)`;
	const mySignupIdSql = sql<string | null>`(
		select vs."id" from "volunteer_signup" vs
		where vs."shift_id" = ${volunteerShift.id} and vs."user_id" = ${userId}
			and vs."status" != 'cancelled'
	)`;
	const interestedSql = sql<number>`(
		select count(*) from "volunteer_role_interest" vri
		where vri."volunteer_role_id" = ${workOrder.volunteerRoleId}
			and vri."user_id" = ${userId}
	)`;

	const rankSql = sql`case
		when ${myStatusSql} is not null then 0
		when ${interestedSql} > 0 then 1
		else 2
	end`;

	const rows = await db
		.select({
			task: workOrder,
			shift: volunteerShift,
			roleId: volunteerRole.id,
			roleName: volunteerRole.name,
			roleGroup: volunteerRole.group,
			eventTitle: eventListing.title,
			claimed: shiftClaimedSql(),
			confirmed: sql<number>`(
				select count(*) from "volunteer_signup" vs
				where vs."shift_id" = ${volunteerShift.id}
					and vs."status" in ('confirmed', 'completed')
			)`,
			myStatus: myStatusSql,
			mySignupId: mySignupIdSql,
			interested: interestedSql
		})
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(and(liveShift(), openTask(), gte(volunteerShift.startsAt, now), notOnCancelledListing()))
		.orderBy(asc(rankSql), asc(volunteerShift.startsAt))
		.limit(opts.limit ?? 50);

	return rows.map((r) => ({
		...toTask(r.task),
		id: r.shift.id,
		workOrderId: r.task.id,
		startsAt: r.shift.startsAt,
		endsAt: r.shift.endsAt,
		capacity: r.shift.capacity,
		notes: r.shift.notes ?? r.task.notes,
		volunteerRoleId: r.roleId,
		roleName: r.roleName,
		roleGroup: r.roleGroup,
		eventTitle: r.eventTitle,
		claimed: Number(r.claimed),
		confirmed: Number(r.confirmed),
		myStatus: r.myStatus,
		mySignupId: r.mySignupId,
		interested: Number(r.interested) > 0,
		isFull: Number(r.claimed) >= r.shift.capacity
	}));
}

// ---------------------------------------------------------------------------
// Assignment mode
// ---------------------------------------------------------------------------

export type WorkOrderMode = 'contractor' | 'open' | 'members' | 'unassigned';

/** The precedence on its own, so it reads (and is tested) apart from the query. */
export function deriveMode(facts: {
	engaged: boolean;
	/** Has a live shift: volunteers can sign up for it. */
	posted: boolean;
	/** Has assignees. */
	staffed: boolean;
}): WorkOrderMode {
	if (facts.engaged) return 'contractor';
	if (facts.posted) return 'open';
	if (facts.staffed) return 'members';
	return 'unassigned';
}

/**
 * Whether the work order in scope has a live engagement: what makes it a
 * contractor's. Declined and cancelled engagements, which carry no spend, do not.
 */
export function liveEngagementSql() {
	const notLive = sql.join(
		contractorJobStatusesWithoutSpend.map((status) => sql`${status}`),
		sql`, `
	);
	return sql<number>`exists (
		select 1 from "contractor_job" cj
		where cj."work_order_id" = ${workOrder.id} and cj."status" not in (${notLive})
	)`;
}

/** Ids per statement: D1 caps bound parameters at 100, and the statuses take some. */
const MODE_CHUNK = 80;

/**
 * Each work order's assignment mode, derived from the rows behind it: one
 * statement per 80 ids, never one per row. Unknown ids are absent from the map.
 */
export async function workOrderModes(ids: string[]): Promise<Map<string, WorkOrderMode>> {
	const batches = await Promise.all(
		chunk([...new Set(ids)], MODE_CHUNK).map((group) =>
			db
				.select({
					id: workOrder.id,
					// Wrapped: drizzle qualifies a column only inside a nested `sql`, and
					// a bare "id" in the subquery would resolve to the inner table's own.
					posted: sql<number>`${hasLiveShiftSql()}`,
					engaged: sql<number>`${liveEngagementSql()}`,
					staffed: sql<number>`${assigneeCountSql()} > 0`
				})
				.from(workOrder)
				.where(inArray(workOrder.id, group))
		)
	);
	return new Map(
		batches
			.flat()
			.map((r) => [
				r.id,
				deriveMode({ engaged: !!r.engaged, posted: !!r.posted, staffed: !!r.staffed })
			])
	);
}

/** A shift row whose role is known: volunteer work, which is all that can be short of people. */
export type RoledShift = ScheduledShiftWithCounts & {
	volunteerRoleId: string;
	roleName: string;
	roleGroup: VolunteerRoleGroup;
};

export function isRoledShift(shift: ScheduledShiftWithCounts): shift is RoledShift {
	return shift.volunteerRoleId !== null && shift.roleName !== null && shift.roleGroup !== null;
}

/**
 * Upcoming shifts still short of people, as rows rather than a per-role count:
 * "which nights are short", for a dashboard panel and a coordinator planning
 * the week. Cancelled shifts are out — nobody can fill one of those.
 */
export async function listShortStaffedShifts(
	withinDays: number,
	from = new Date()
): Promise<RoledShift[]> {
	const to = new Date(from.getTime() + withinDays * 24 * 60 * 60 * 1000);
	const rows = await listShifts({ from, to });
	return rows.filter(isRoledShift).filter((shift) => shift.claimed < shift.capacity);
}
