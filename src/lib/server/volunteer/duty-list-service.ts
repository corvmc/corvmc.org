import { db } from '$lib/server/db';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import {
	dutyList,
	dutyListItem,
	volunteerRole,
	workOrder,
	workTask
} from '$lib/server/db/schema/volunteer';
import { eventListing } from '$lib/server/db/schema/event';
import { reservation } from '$lib/server/db/schema/reservation';
import {
	VOLUNTEER_SHIFT_MAX_CAPACITY,
	VOLUNTEER_SHIFT_MAX_MINUTES,
	VOLUNTEER_SHIFT_NOTES_MAX,
	dutyListSubjectLabels
} from '$lib/config';
import type { DutyListAnchor, DutyListAutoApplyTrigger, DutyListSubject } from '$lib/config';
import type { DutyList, DutyListItem } from '$lib/server/db/schema/volunteer';
import { chunk, chunkSize } from '$lib/server/utils/chunk';

/**
 * Duty lists: a named set of work orders, stamped onto a subject.
 *
 * Staffing a show is six work orders — Booking Lead a week out, then Door, Tech,
 * Merch and Tear Down around doors — and every one of them is entered by hand
 * today. This is that, once.
 *
 * Applying a list writes ordinary `work_order` rows. They carry
 * `dutyListId` for provenance and nothing else: editing a list afterwards must
 * not reach into work people have already claimed, which is the same bargain
 * `duplicateShift` makes when it says the copy has "no link back".
 *
 * The subject is a show or a rehearsal booking. Both are a window with a start
 * and an end, which is all an offset needs, so the two share one apply and one
 * output — the only difference is which anchor column the work order carries
 * and whether `doors` means anything.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DutyListNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Duty list not found');
	}
}

export class DutyListItemNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Duty list item not found');
	}
}

export class WorkTaskNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Task not found');
	}
}

export class DutyListNameTakenError extends DomainError {
	readonly httpStatus = 409;
	constructor(name: string) {
		super(`A duty list named "${name}" already exists`);
	}
}

/**
 * Applying twice would silently double the roster, and the second apply looks
 * exactly like the first from the outside — so it is refused by name rather
 * than deduplicated.
 */
export class DutyListAlreadyAppliedError extends DomainError {
	readonly httpStatus = 409;
	constructor(name: string, existing: number) {
		super(
			`"${name}" has already been applied to this one — it created ${existing} ` +
				`work ${existing === 1 ? 'order' : 'orders'}. Cancel those first if you want to redo it.`
		);
	}
}

export class DutyListValidationError extends DomainError {
	readonly httpStatus = 422;
	constructor(
		message: string,
		readonly field?: string
	) {
		super(message);
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateCapacity(capacity: number): number {
	if (!Number.isInteger(capacity) || capacity < 1) {
		throw new DutyListValidationError('Capacity must be at least 1.', 'capacity');
	}
	if (capacity > VOLUNTEER_SHIFT_MAX_CAPACITY) {
		throw new DutyListValidationError(
			`Capacity cannot exceed ${VOLUNTEER_SHIFT_MAX_CAPACITY}.`,
			'capacity'
		);
	}
	return capacity;
}

function validateNotes(notes?: string | null): string | null {
	const trimmed = notes?.trim();
	if (!trimmed) return null;
	if (trimmed.length > VOLUNTEER_SHIFT_NOTES_MAX) {
		throw new DutyListValidationError(
			`Notes cannot exceed ${VOLUNTEER_SHIFT_NOTES_MAX} characters.`,
			'notes'
		);
	}
	return trimmed;
}

function validateTasks(tasks: string[]): string[] {
	const cleaned = tasks.map((t) => t.trim()).filter(Boolean);
	for (const t of cleaned) {
		if (t.length > 200) {
			throw new DutyListValidationError('A task label cannot exceed 200 characters.', 'tasks');
		}
	}
	return cleaned;
}

/**
 * An item is either a window or a deadline, never both and never neither —
 * the same shape `duty_list_item_one_shape` enforces in SQL. Checked here too so
 * the message names the problem instead of surfacing a constraint failure.
 */
function validateShape(input: {
	offsetMinutes?: number | null;
	durationMinutes?: number | null;
	dueOffsetMinutes?: number | null;
}): {
	offsetMinutes: number | null;
	durationMinutes: number | null;
	dueOffsetMinutes: number | null;
} {
	const offsetMinutes = input.offsetMinutes ?? null;
	const durationMinutes = input.durationMinutes ?? null;
	const dueOffsetMinutes = input.dueOffsetMinutes ?? null;

	const windowed = offsetMinutes !== null || durationMinutes !== null;

	if (windowed && dueOffsetMinutes !== null) {
		throw new DutyListValidationError(
			'An item is either scheduled or due by a date, not both.',
			'dueOffsetMinutes'
		);
	}
	if (!windowed && dueOffsetMinutes === null) {
		throw new DutyListValidationError(
			'Give the item either a start offset and duration, or a due offset.',
			'offsetMinutes'
		);
	}
	if (windowed && (offsetMinutes === null || durationMinutes === null)) {
		throw new DutyListValidationError(
			'A scheduled item needs both a start offset and a duration.',
			'durationMinutes'
		);
	}
	if (durationMinutes !== null) {
		if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
			throw new DutyListValidationError('Duration must be at least a minute.', 'durationMinutes');
		}
		if (durationMinutes > VOLUNTEER_SHIFT_MAX_MINUTES) {
			throw new DutyListValidationError(
				`Duration cannot exceed ${VOLUNTEER_SHIFT_MAX_MINUTES} minutes.`,
				'durationMinutes'
			);
		}
	}

	return { offsetMinutes, durationMinutes, dueOffsetMinutes };
}

// ---------------------------------------------------------------------------
// Duty lists
// ---------------------------------------------------------------------------

export interface DutyListRow extends DutyList {
	itemCount: number;
}

export async function listDutyLists(
	opts: { includeInactive?: boolean; subject?: DutyListSubject } = {}
) {
	const filters = [
		opts.includeInactive ? undefined : eq(dutyList.isActive, true),
		opts.subject ? eq(dutyList.subject, opts.subject) : undefined
	].filter(Boolean);

	const rows = await db
		.select({
			list: dutyList,
			itemCount: count(dutyListItem.id)
		})
		.from(dutyList)
		.leftJoin(dutyListItem, eq(dutyListItem.dutyListId, dutyList.id))
		.where(filters.length ? and(...filters) : undefined)
		.groupBy(dutyList.id)
		.orderBy(asc(dutyList.name));

	return rows.map((r) => ({ ...r.list, itemCount: r.itemCount })) satisfies DutyListRow[];
}

export interface DutyListItemRow extends DutyListItem {
	roleName: string;
}

export interface DutyListDetail {
	list: DutyList;
	items: DutyListItemRow[];
}

export async function getDutyListDetail(id: string): Promise<DutyListDetail | null> {
	const [list] = await db.select().from(dutyList).where(eq(dutyList.id, id)).limit(1);
	if (!list) return null;

	const rows = await db
		.select({ item: dutyListItem, roleName: volunteerRole.name })
		.from(dutyListItem)
		.innerJoin(volunteerRole, eq(volunteerRole.id, dutyListItem.volunteerRoleId))
		.where(eq(dutyListItem.dutyListId, id))
		.orderBy(asc(dutyListItem.sortOrder));

	return { list, items: rows.map((r) => ({ ...r.item, roleName: r.roleName })) };
}

export async function createDutyList(data: {
	name: string;
	description?: string | null;
	anchor: DutyListAnchor;
	subject?: DutyListSubject;
	autoApplyOn?: DutyListAutoApplyTrigger | null;
	createdByUserId: string;
}): Promise<DutyList> {
	const name = data.name.trim();
	if (!name) throw new DutyListValidationError('Name is required.', 'name');

	const subject = data.subject ?? 'event';
	assertAnchorFitsSubject(data.anchor, subject);

	const [existing] = await db
		.select({ id: dutyList.id })
		.from(dutyList)
		.where(eq(dutyList.name, name))
		.limit(1);
	if (existing) throw new DutyListNameTakenError(name);

	const [row] = await db
		.insert(dutyList)
		.values({
			name,
			description: data.description?.trim() || null,
			anchor: data.anchor,
			subject,
			autoApplyOn: data.autoApplyOn ?? null,
			createdByUserId: data.createdByUserId
		})
		.returning();

	return row;
}

export async function updateDutyList(
	id: string,
	data: {
		name?: string;
		description?: string | null;
		anchor?: DutyListAnchor;
		subject?: DutyListSubject;
		autoApplyOn?: DutyListAutoApplyTrigger | null;
		isActive?: boolean;
	}
): Promise<DutyList> {
	const [existing] = await db.select().from(dutyList).where(eq(dutyList.id, id)).limit(1);
	if (!existing) throw new DutyListNotFoundError();

	// Check the pair the row would *end up* with, not the half that moved:
	// switching a doors-anchored list to a reservation is as illegal as
	// switching a reservation list to doors, and either edit alone looks fine.
	assertAnchorFitsSubject(data.anchor ?? existing.anchor, data.subject ?? existing.subject);

	const updates: Partial<typeof dutyList.$inferInsert> = { updatedAt: new Date() };

	if (data.name !== undefined) {
		const name = data.name.trim();
		if (!name) throw new DutyListValidationError('Name is required.', 'name');
		if (name !== existing.name) {
			const [clash] = await db
				.select({ id: dutyList.id })
				.from(dutyList)
				.where(eq(dutyList.name, name))
				.limit(1);
			if (clash) throw new DutyListNameTakenError(name);
		}
		updates.name = name;
	}
	if (data.description !== undefined) updates.description = data.description?.trim() || null;
	if (data.anchor !== undefined) updates.anchor = data.anchor;
	if (data.subject !== undefined) updates.subject = data.subject;
	if (data.autoApplyOn !== undefined) updates.autoApplyOn = data.autoApplyOn;
	if (data.isActive !== undefined) updates.isActive = data.isActive;

	const [row] = await db.update(dutyList).set(updates).where(eq(dutyList.id, id)).returning();
	return row;
}

/**
 * Deleting a list leaves every work order it ever produced alone —
 * `work_order.dutyListId` is set-null, and the shifts are the record of
 * work that actually happened.
 */
export async function deleteDutyList(id: string): Promise<void> {
	const [existing] = await db
		.select({ id: dutyList.id })
		.from(dutyList)
		.where(eq(dutyList.id, id))
		.limit(1);
	if (!existing) throw new DutyListNotFoundError();

	await db.delete(dutyList).where(eq(dutyList.id, id));
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface DutyListItemInput {
	volunteerRoleId: string;
	offsetMinutes?: number | null;
	durationMinutes?: number | null;
	dueOffsetMinutes?: number | null;
	capacity: number;
	notes?: string | null;
	sortOrder?: number;
	tasks?: string[];
}

export async function addDutyListItem(
	dutyListId: string,
	input: DutyListItemInput
): Promise<DutyListItem> {
	const [list] = await db
		.select({ id: dutyList.id })
		.from(dutyList)
		.where(eq(dutyList.id, dutyListId))
		.limit(1);
	if (!list) throw new DutyListNotFoundError();

	const [role] = await db
		.select({ id: volunteerRole.id, isActive: volunteerRole.isActive })
		.from(volunteerRole)
		.where(eq(volunteerRole.id, input.volunteerRoleId))
		.limit(1);
	if (!role) throw new DutyListValidationError('That role no longer exists.', 'volunteerRoleId');
	if (!role.isActive) {
		throw new DutyListValidationError(
			'That role is archived — restore it before putting it on a duty list.',
			'volunteerRoleId'
		);
	}

	const shape = validateShape(input);

	const [row] = await db
		.insert(dutyListItem)
		.values({
			dutyListId,
			volunteerRoleId: input.volunteerRoleId,
			...shape,
			capacity: validateCapacity(input.capacity),
			notes: validateNotes(input.notes),
			sortOrder: input.sortOrder ?? 0,
			tasks: validateTasks(input.tasks ?? [])
		})
		.returning();

	return row;
}

export async function updateDutyListItem(
	id: string,
	input: Partial<DutyListItemInput>
): Promise<DutyListItem> {
	const [existing] = await db.select().from(dutyListItem).where(eq(dutyListItem.id, id)).limit(1);
	if (!existing) throw new DutyListItemNotFoundError();

	// The shape is validated as a whole, not field by field: clearing an offset
	// and setting a due offset is one legal edit made of two illegal halves.
	const shape = validateShape({
		offsetMinutes: input.offsetMinutes !== undefined ? input.offsetMinutes : existing.offsetMinutes,
		durationMinutes:
			input.durationMinutes !== undefined ? input.durationMinutes : existing.durationMinutes,
		dueOffsetMinutes:
			input.dueOffsetMinutes !== undefined ? input.dueOffsetMinutes : existing.dueOffsetMinutes
	});

	const updates: Partial<typeof dutyListItem.$inferInsert> = { ...shape, updatedAt: new Date() };
	if (input.volunteerRoleId !== undefined) updates.volunteerRoleId = input.volunteerRoleId;
	if (input.capacity !== undefined) updates.capacity = validateCapacity(input.capacity);
	if (input.notes !== undefined) updates.notes = validateNotes(input.notes);
	if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
	if (input.tasks !== undefined) updates.tasks = validateTasks(input.tasks);

	const [row] = await db
		.update(dutyListItem)
		.set(updates)
		.where(eq(dutyListItem.id, id))
		.returning();
	return row;
}

export async function removeDutyListItem(id: string): Promise<void> {
	const [existing] = await db
		.select({ id: dutyListItem.id })
		.from(dutyListItem)
		.where(eq(dutyListItem.id, id))
		.limit(1);
	if (!existing) throw new DutyListItemNotFoundError();

	await db.delete(dutyListItem).where(eq(dutyListItem.id, id));
}

// ---------------------------------------------------------------------------
// Applying a list
// ---------------------------------------------------------------------------

/**
 * Column count for `chunkSize` — see `$lib/server/utils/chunk`. A six-item list
 * with eight tasks each clears D1's parameter ceiling on the task insert alone,
 * so the chunking is not optional.
 */
const TASK_COLUMNS = 4;

export interface ApplyDutyListResult {
	workOrderIds: string[];
	taskCount: number;
}

/**
 * What a duty list is stamped onto. A union rather than two loose ids, so a
 * caller cannot hand an event id to the reservation branch.
 */
export type DutySubject = { kind: 'event'; id: string } | { kind: 'reservation'; id: string };

/** Both subjects, in the only shape an offset actually needs. */
interface TimedSubject {
	kind: DutyListSubject;
	id: string;
	startsAt: Date;
	endsAt: Date | null;
	/** Always null for a reservation — a rehearsal has no doors. */
	doorsAt: Date | null;
}

async function loadSubject(subject: DutySubject): Promise<TimedSubject | null> {
	if (subject.kind === 'event') {
		const [row] = await db
			.select({
				id: eventListing.id,
				startsAt: eventListing.startsAt,
				endsAt: eventListing.endsAt,
				doorsAt: eventListing.doorsAt
			})
			.from(eventListing)
			.where(eq(eventListing.id, subject.id))
			.limit(1);
		return row ? { kind: 'event', ...row } : null;
	}

	const [row] = await db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt
		})
		.from(reservation)
		.where(eq(reservation.id, subject.id))
		.limit(1);
	return row ? { kind: 'reservation', ...row, doorsAt: null } : null;
}

/**
 * A list anchored to `doors` cannot be stamped onto a rehearsal booking.
 *
 * `resolveAnchor` falls back from `doorsAt` to `startsAt` for an event because
 * not every show sets a doors time — but a show without one still *has* doors.
 * A rehearsal has no such concept, so taking the same fallback would quietly
 * turn "fifteen minutes before doors" into "fifteen minutes before the booking"
 * and read as correct on every screen. Refuse it at save time, so the pairing is
 * unmakeable rather than merely unappliable.
 */
function assertAnchorFitsSubject(anchor: DutyListAnchor, subject: DutyListSubject): void {
	if (anchor === 'doors' && subject !== 'event') {
		throw new DutyListValidationError(
			`${dutyListSubjectLabels[subject]} has no doors time — anchor this list to the start or the end instead.`,
			'anchor'
		);
	}
}

/**
 * Stamp a duty list onto a subject — a show, or a member's rehearsal booking.
 *
 * Offsets are plain instant arithmetic from a real anchor timestamp, so daylight
 * saving needs no special handling here — unlike `duplicateShift`, which shifts a
 * wall-clock date and does.
 *
 * `createdByUserId` is nullable because the orientation listener applies a list
 * with no acting user; `work_order.created_by_user_id` is already set-null.
 */
export async function applyDutyList(
	dutyListId: string,
	subject: DutySubject,
	createdByUserId: string | null
): Promise<ApplyDutyListResult> {
	const detail = await getDutyListDetail(dutyListId);
	if (!detail) throw new DutyListNotFoundError();
	const { list, items } = detail;

	if (items.length === 0) {
		throw new DutyListValidationError('That duty list has no items on it yet.');
	}

	if (list.subject !== subject.kind) {
		throw new DutyListValidationError(
			`"${list.name}" is for ${dutyListSubjectLabels[list.subject].toLowerCase()}, not ${dutyListSubjectLabels[subject.kind].toLowerCase()}.`
		);
	}

	const subj = await loadSubject(subject);
	if (!subj) {
		throw new DutyListValidationError(
			`That ${subject.kind === 'event' ? 'event' : 'booking'} no longer exists.`,
			subject.kind === 'event' ? 'eventId' : 'reservationId'
		);
	}

	// Refuse rather than double the roster. Cancelled work orders do not count:
	// cancelling the lot is how you redo an apply.
	//
	// This is also what makes the orientation listener idempotent — a repeated
	// domain event lands here and is refused by name, so the machinery that stops
	// a coordinator double-clicking Apply is the machinery that stops a
	// re-delivered event doubling somebody's orientation.
	const anchorColumn = subject.kind === 'event' ? workOrder.eventId : workOrder.reservationId;
	const [{ existing }] = await db
		.select({ existing: count() })
		.from(workOrder)
		.where(
			and(
				eq(anchorColumn, subject.id),
				eq(workOrder.dutyListId, dutyListId),
				isNull(workOrder.cancelledAt)
			)
		);
	if (existing > 0) throw new DutyListAlreadyAppliedError(list.name, existing);

	const anchor = resolveAnchor(list.anchor, subj);

	const shiftRows: (typeof workOrder.$inferInsert)[] = [];
	const taskRows: (typeof workTask.$inferInsert)[] = [];

	for (const item of items) {
		const workOrderId = crypto.randomUUID();

		const scheduled = item.offsetMinutes !== null && item.durationMinutes !== null;
		const startsAt = scheduled ? addMinutes(anchor, item.offsetMinutes!) : null;

		shiftRows.push({
			id: workOrderId,
			volunteerRoleId: item.volunteerRoleId,
			// Exactly one anchor is set. There is deliberately no CHECK forbidding
			// both — a work order can legitimately carry several — but a list
			// stamps out one subject's worth of work.
			eventId: subject.kind === 'event' ? subject.id : null,
			reservationId: subject.kind === 'reservation' ? subject.id : null,
			startsAt,
			endsAt: scheduled ? addMinutes(startsAt!, item.durationMinutes!) : null,
			dueAt: item.dueOffsetMinutes !== null ? addMinutes(anchor, item.dueOffsetMinutes) : null,
			capacity: item.capacity,
			notes: item.notes,
			dutyListId,
			createdByUserId
		});

		item.tasks.forEach((label, i) => {
			taskRows.push({ workOrderId, label, sortOrder: i });
		});
	}

	// Work orders first: a task carries `work_order_id`, so the row it names has
	// to exist. `db.batch` and not `db.transaction` — the latter is broken on D1.
	await db.batch(
		shiftRows.map((row) => db.insert(workOrder).values(row)) as unknown as Parameters<
			typeof db.batch
		>[0]
	);

	if (taskRows.length > 0) {
		await db.batch(
			chunk(taskRows, chunkSize(TASK_COLUMNS)).map((g) =>
				db.insert(workTask).values(g)
			) as unknown as Parameters<typeof db.batch>[0]
		);
	}

	return { workOrderIds: shiftRows.map((r) => r.id!), taskCount: taskRows.length };
}

function resolveAnchor(anchor: DutyListAnchor, subj: TimedSubject): Date {
	switch (anchor) {
		case 'doors':
			// Mirrors the production page's shift modal, which prefills from
			// `doorsAt ?? startsAt` for the same reason: not every show sets doors.
			// `assertAnchorFitsSubject` has already refused a non-event subject, so
			// the fallback can never stand in for a doors time that does not exist
			// as a concept.
			assertAnchorFitsSubject(anchor, subj.kind);
			return subj.doorsAt ?? subj.startsAt;
		case 'start':
			return subj.startsAt;
		case 'end':
			// Only reachable for an event: `reservation.ends_at` is NOT NULL.
			if (!subj.endsAt) {
				throw new DutyListValidationError(
					'This list is anchored to the end, and this event has no end time.',
					'eventId'
				);
			}
			return subj.endsAt;
	}
}

function addMinutes(at: Date, minutes: number): Date {
	return new Date(at.getTime() + minutes * 60_000);
}

// ---------------------------------------------------------------------------
// Work tasks
// ---------------------------------------------------------------------------

export async function listWorkTasks(workOrderId: string) {
	return db
		.select()
		.from(workTask)
		.where(eq(workTask.workOrderId, workOrderId))
		.orderBy(asc(workTask.sortOrder));
}

/**
 * Tick or untick one task.
 *
 * `doneByUserId` is attribution — who says the trash went out — and never
 * credit. Hours belong to the work order, and nothing here touches them.
 */
export async function setWorkTaskDone(id: string, done: boolean, userId: string) {
	const [existing] = await db
		.select({ id: workTask.id })
		.from(workTask)
		.where(eq(workTask.id, id))
		.limit(1);
	if (!existing) throw new WorkTaskNotFoundError();

	const [row] = await db
		.update(workTask)
		.set({
			done,
			// Both move together, or `work_task_done_has_time` rejects the write.
			doneAt: done ? new Date() : null,
			doneByUserId: done ? userId : null,
			updatedAt: new Date()
		})
		.where(eq(workTask.id, id))
		.returning();

	return row;
}

/** How many of a work order's tasks are ticked — the close-out card's number. */
export async function countTasks(workOrderIds: string[]) {
	if (workOrderIds.length === 0) return new Map<string, { total: number; done: number }>();

	const rows = await db
		.select({
			workOrderId: workTask.workOrderId,
			total: count(),
			done: sql<number>`sum(case when ${workTask.done} then 1 else 0 end)`
		})
		.from(workTask)
		.where(
			sql`${workTask.workOrderId} in (${sql.join(
				workOrderIds.map((id) => sql`${id}`),
				sql`, `
			)})`
		)
		.groupBy(workTask.workOrderId);

	return new Map(rows.map((r) => [r.workOrderId, { total: r.total, done: Number(r.done) }]));
}
