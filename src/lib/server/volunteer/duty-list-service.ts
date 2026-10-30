import { db } from '$lib/server/db';
import { toGenericRef } from '$lib/server/entity/refs';
import { and, asc, count, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { placePendingWorkOrders } from './retime-work-orders';
import { DomainError } from '$lib/server/domain-error';
import {
	dutyList,
	dutyListItem,
	volunteerRole,
	volunteerSignup,
	workOrder,
	workTask
} from '$lib/server/db/schema/volunteer';
import { eventListing } from '$lib/server/db/schema/event';
import { production } from '$lib/server/db/schema/production';
import { project } from '$lib/server/db/schema/project';
import { group } from '$lib/server/db/schema/group';
import {
	VOLUNTEER_SHIFT_MAX_CAPACITY,
	VOLUNTEER_SHIFT_MAX_MINUTES,
	VOLUNTEER_SHIFT_NOTES_MAX,
	VOLUNTEER_SHIFT_TITLE_MAX,
	dutyListAnchorLabels,
	eventDutyListAnchors
} from '$lib/config';
import type { DutyListAnchor, DutyListAutoApplyTrigger, WorkDoneCondition } from '$lib/config';
import type { DutyList, DutyListItem } from '$lib/server/db/schema/volunteer';
import { chunk, chunkSize } from '$lib/server/utils/chunk';
import {
	ensureSections,
	nextTaskOrders,
	sectionNameKey,
	projectSubject
} from '$lib/server/project/project-section-service';
import { recordAuditEntry } from '$lib/server/audit/audit-service';

/**
 * Project templates (the `duty_list` tables): a named set of work orders,
 * stamped into a project, or for orientation onto a rehearsal booking.
 *
 * Applying one writes ordinary `work_order` rows carrying `dutyListId` for
 * provenance, plus the anchor and orientation facts copied at stamp time.
 * Editing a template afterwards never reaches work already stamped.
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

/**
 * Authorisation by assignment rather than by capability.
 *
 * `volunteer.manageShifts` is the capability for administering the programme,
 * so gating a checkbox on it means the setup crew has to ask a coordinator to
 * record that the stage was swept. Being rostered on the work is the right
 * predicate, and it is one the database can answer.
 */
export class NotAssignedToShiftError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('That task is not on a shift you are working');
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

function validateTitle(title?: string | null): string | null {
	const trimmed = title?.trim();
	if (!trimmed) return null;
	if (trimmed.length > VOLUNTEER_SHIFT_TITLE_MAX) {
		throw new DutyListValidationError(
			`Keep the title under ${VOLUNTEER_SHIFT_TITLE_MAX} characters.`,
			'title'
		);
	}
	return trimmed;
}

/**
 * An owner has to be a live committee, as `maintenance_schedule` and
 * `project_committee` require: a band or a club answers for no show work.
 */
export async function assertOwningCommittee(
	groupId: string | null | undefined
): Promise<string | null> {
	if (!groupId) return null;
	const [row] = await db
		.select({ kind: group.kind, deletedAt: group.deletedAt })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	if (!row || row.deletedAt || row.kind !== 'committee') {
		throw new DutyListValidationError('Only a committee can own this.', 'groupId');
	}
	return groupId;
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

/**
 * Project templates. A `reservation`-subject list predates the orientation
 * setting and is retired: never listed, opened or applied.
 */
const isTemplate = eq(dutyList.subject, 'project');

export async function listDutyLists(opts: { includeInactive?: boolean } = {}) {
	const filters = [
		opts.includeInactive ? undefined : eq(dutyList.isActive, true),
		isTemplate
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

	return rows.map((r) => ({
		...r.list,
		itemCount: r.itemCount
	})) satisfies DutyListRow[];
}

export interface DutyListItemRow extends DutyListItem {
	roleName: string;
	/** The owning committee's name, or null for staff's. */
	groupName: string | null;
	/** The role as a record, so the item can link to it. */
	role: import('$lib/types/entity').GenericRef;
}

export interface DutyListDetail {
	list: DutyList;
	items: DutyListItemRow[];
}

export async function getDutyListDetail(id: string): Promise<DutyListDetail | null> {
	const [list] = await db
		.select()
		.from(dutyList)
		.where(and(eq(dutyList.id, id), isTemplate))
		.limit(1);
	if (!list) return null;

	const rows = await db
		.select({
			item: dutyListItem,
			roleName: volunteerRole.name,
			roleId: volunteerRole.id,
			groupName: group.name
		})
		.from(dutyListItem)
		.innerJoin(volunteerRole, eq(volunteerRole.id, dutyListItem.volunteerRoleId))
		.leftJoin(group, eq(group.id, dutyListItem.groupId))
		.where(eq(dutyListItem.dutyListId, id))
		.orderBy(asc(dutyListItem.sortOrder));

	return {
		list,
		items: rows.map((r) => ({
			...r.item,
			roleName: r.roleName,
			groupName: r.groupName,
			// A duty list item *is* a role at an offset, and the role was a bare
			// string with no way to reach it.
			role: toGenericRef('role', { id: r.roleId, title: r.roleName })
		}))
	};
}

export async function createDutyList(data: {
	name: string;
	description?: string | null;
	anchor: DutyListAnchor;
	autoApplyOn?: DutyListAutoApplyTrigger | null;
	createdByUserId: string;
}): Promise<DutyList> {
	const name = data.name.trim();
	if (!name) throw new DutyListValidationError('Name is required.', 'name');

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
			subject: 'project',
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
		autoApplyOn?: DutyListAutoApplyTrigger | null;
		isActive?: boolean;
	}
): Promise<DutyList> {
	const [existing] = await db
		.select()
		.from(dutyList)
		.where(and(eq(dutyList.id, id), isTemplate))
		.limit(1);
	if (!existing) throw new DutyListNotFoundError();

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
	title?: string | null;
	/** The owning committee. Null leaves the item staff's. */
	groupId?: string | null;
	doneWhen?: WorkDoneCondition | null;
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
			tasks: validateTasks(input.tasks ?? []),
			title: validateTitle(input.title),
			groupId: await assertOwningCommittee(input.groupId),
			doneWhen: input.doneWhen ?? null
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
	if (input.title !== undefined) updates.title = validateTitle(input.title);
	if (input.groupId !== undefined) updates.groupId = await assertOwningCommittee(input.groupId);
	if (input.doneWhen !== undefined) updates.doneWhen = input.doneWhen;

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
	/** Why some items landed unscheduled. Empty when every anchor had a time. */
	warnings: string[];
}

/**
 * The project a template is stamped into. `eventId` names the show whose times
 * the event anchors read; left out, it is the project's earliest.
 */
export type DutySubject = { kind: 'project'; id: string; eventId?: string | null };

/** The project a show's work belongs to: its own, or its production's. */
export async function projectOfEvent(eventId: string): Promise<string | null> {
	const [row] = await db
		.select({ own: eventListing.projectId, show: production.projectId })
		.from(eventListing)
		.leftJoin(production, eq(production.id, eventListing.productionId))
		.where(eq(eventListing.id, eventId))
		.limit(1);
	return row?.own ?? row?.show ?? null;
}

/** The times an anchor can resolve to. A null is a time not set yet. */
interface Clock {
	projectStartsAt: Date | null;
	/** The show the event anchors read, if the project has one. */
	event: {
		id: string;
		startsAt: Date;
		endsAt: Date | null;
		doorsAt: Date | null;
		hasProduction: boolean;
		loadInAt: Date | null;
		soundcheckAt: Date | null;
		firstSetAt: Date | null;
		curfewAt: Date | null;
		loadOutBy: Date | null;
	} | null;
}

async function loadEventClock(where: SQL): Promise<Clock['event']> {
	// Left join: a listing with no production still has its own clock.
	const [row] = await db
		.select({
			id: eventListing.id,
			startsAt: eventListing.startsAt,
			endsAt: eventListing.endsAt,
			doorsAt: eventListing.doorsAt,
			productionId: production.id,
			loadInAt: production.loadInAt,
			soundcheckAt: production.soundcheckAt,
			firstSetAt: production.firstSetAt,
			curfewAt: production.curfewAt,
			loadOutBy: production.loadOutBy
		})
		.from(eventListing)
		.leftJoin(production, eq(production.id, eventListing.productionId))
		.where(where)
		.orderBy(asc(eventListing.startsAt))
		.limit(1);
	if (!row) return null;
	const { productionId, ...rest } = row;
	return { ...rest, hasProduction: productionId !== null };
}

async function loadClock(subject: DutySubject): Promise<Clock | null> {
	const [row] = await db
		.select({ startsAt: project.startsAt })
		.from(project)
		.where(eq(project.id, subject.id))
		.limit(1);
	if (!row) return null;
	// A festival is one project over several nights; its event anchors time
	// from the first of them that is still on.
	const event = await loadEventClock(
		subject.eventId
			? eq(eventListing.id, subject.eventId)
			: and(
					eq(eventListing.projectId, subject.id),
					notInArray(eventListing.status, ['cancelled', 'rejected'])
				)!
	);
	return { projectStartsAt: row.startsAt, event };
}

/**
 * The anchor's time, or why there is none yet. A missing time is a warning,
 * not a refusal: the items land unscheduled and are placed once it is set.
 */
function resolveAnchor(
	anchor: DutyListAnchor,
	clock: Clock
): { at: Date; missing: null } | { at: null; missing: string } {
	const label = dutyListAnchorLabels[anchor].toLowerCase();
	const found = (at: Date | null, missing: string) =>
		at ? { at, missing: null } : { at: null, missing };

	if (anchor === 'project_start') {
		return found(clock.projectStartsAt, 'The project has no start date yet.');
	}
	const event = clock.event;
	if (!event) return found(null, 'The project has no event yet.');
	switch (anchor) {
		case 'doors':
			// Not every show sets doors; the shift modal prefills the same way.
			return found(event.doorsAt ?? event.startsAt, '');
		case 'start':
			return found(event.startsAt, '');
		case 'end':
			return found(event.endsAt, 'The event has no end time yet.');
	}
	if (!event.hasProduction) return found(null, 'The show has no production yet.');
	const at = {
		load_in: event.loadInAt,
		soundcheck: event.soundcheckAt,
		first_set: event.firstSetAt,
		curfew: event.curfewAt,
		load_out: event.loadOutBy
	}[anchor];
	return found(at, `The show has no ${label} time yet.`);
}

/**
 * Name the project's first event on template work stamped before it had one,
 * then place that work at each anchor whose time is already set (#2084). It is
 * the event `applyDutyList` would have read; an anchor still unset stays
 * pending and is placed by that event's own retime.
 */
export async function placeWorkAwaitingEvent(projectId: string) {
	const clock = await loadClock({ kind: 'project', id: projectId });
	const event = clock?.event;
	if (!clock || !event) return;

	const claim = db
		.update(workOrder)
		.set({ eventId: event.id, updatedAt: new Date() })
		.where(
			and(
				eq(workOrder.projectId, projectId),
				isNull(workOrder.eventId),
				inArray(workOrder.anchor, [...eventDutyListAnchors]),
				isNull(workOrder.cancelledAt),
				isNull(workOrder.resolvedAt)
			)
		);
	const places = eventDutyListAnchors.flatMap((anchor) => {
		const { at } = resolveAnchor(anchor, clock);
		if (!at) return [];
		const seconds = Math.floor(at.getTime() / 1000);
		return [placePendingWorkOrders({ eventId: event.id }, [anchor], sql`${seconds}`)];
	});
	await db.batch([claim, ...places] as unknown as Parameters<typeof db.batch>[0]);
}

/**
 * Stamp a template into a project.
 *
 * Offsets are instant arithmetic from a real anchor timestamp, so daylight
 * saving needs no handling here. Applying a template a second time warns: by
 * hand it goes ahead with a reason, which is audited; without one (as from a
 * listener) it is refused. `createdByUserId` is null when a listener applies it.
 */
export async function applyDutyList(
	dutyListId: string,
	subject: DutySubject,
	createdByUserId: string | null,
	opts: { reason?: string | null } = {}
): Promise<ApplyDutyListResult> {
	const detail = await getDutyListDetail(dutyListId);
	if (!detail) throw new DutyListNotFoundError();
	const { list, items } = detail;

	if (items.length === 0) {
		throw new DutyListValidationError('That template has no items on it yet.');
	}

	const clock = await loadClock(subject);
	if (!clock) throw new DutyListValidationError('That project no longer exists.', 'projectId');

	// Cancelled work orders do not count: cancelling the lot is how you redo an
	// apply. A repeated domain event lands here with no reason and is refused by
	// name, which is what keeps the listeners idempotent.
	const [{ existing }] = await db
		.select({ existing: count() })
		.from(workOrder)
		.where(
			and(
				eq(workOrder.projectId, subject.id),
				eq(workOrder.dutyListId, dutyListId),
				isNull(workOrder.cancelledAt)
			)
		);
	const reason = opts.reason?.trim() || null;
	if (existing > 0 && !reason) throw new DutyListAlreadyAppliedError(list.name, existing);

	const { at: anchor, missing } = resolveAnchor(list.anchor, clock);
	const readsEvent = (eventDutyListAnchors as readonly string[]).includes(list.anchor);
	const eventId = readsEvent ? (clock.event?.id ?? null) : null;

	// Each item lands under its named heading, after what is already there.
	const [sections, nextOrder] = await Promise.all([
		ensureSections(
			subject.id,
			items.flatMap((i) => (i.section ? [i.section] : []))
		),
		nextTaskOrders(subject.id)
	]);
	const place = (name: string | null) => {
		const sectionId = (name && sections.get(sectionNameKey(name))) || null;
		const sortOrder = nextOrder.get(sectionId) ?? 0;
		nextOrder.set(sectionId, sortOrder + 1);
		return { sectionId, sortOrder };
	};

	const shiftRows: (typeof workOrder.$inferInsert)[] = [];
	const taskRows: (typeof workTask.$inferInsert)[] = [];

	for (const item of items) {
		const workOrderId = crypto.randomUUID();
		const windowed = item.offsetMinutes !== null && item.durationMinutes !== null;
		const startsAt = anchor && windowed ? addMinutes(anchor, item.offsetMinutes!) : null;

		shiftRows.push({
			id: workOrderId,
			volunteerRoleId: item.volunteerRoleId,
			eventId,
			projectId: subject.id,
			startsAt,
			endsAt: startsAt ? addMinutes(startsAt, item.durationMinutes!) : null,
			dueAt:
				anchor && item.dueOffsetMinutes !== null ? addMinutes(anchor, item.dueOffsetMinutes) : null,
			// No time to measure from yet: keep the offset so retime can place it.
			pendingOffsetMinutes: anchor ? null : (item.offsetMinutes ?? item.dueOffsetMinutes),
			pendingDurationMinutes: anchor ? null : item.durationMinutes,
			capacity: item.capacity,
			notes: item.notes,
			// A copy, like the rest: re-owning the template leaves this show alone.
			title: item.title,
			groupId: item.groupId,
			doneWhen: item.doneWhen,
			dutyListId,
			anchor: list.anchor,
			...place(item.section),
			// On the claim board, as every stamped-out shift has always been.
			postedAt: new Date(),
			postedByUserId: createdByUserId,
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

	const n = shiftRows.length;
	const warnings = missing
		? [`${missing} ${n === 1 ? 'Its item stays' : `All ${n} items stay`} unscheduled until then.`]
		: [];

	await recordAuditEntry({
		action: 'project.duty_list_applied',
		subject: await projectSubject(subject.id),
		details: {
			dutyListId,
			dutyListName: list.name,
			tasks: shiftRows.length,
			...(existing > 0 ? { reappliedReason: reason! } : {})
		}
	});
	return {
		workOrderIds: shiftRows.map((r) => r.id!),
		taskCount: taskRows.length,
		warnings
	};
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

/**
 * Tick a task on a shift you are actually working.
 *
 * The assignment is checked in SQL, in one statement with the lookup, so there
 * is no window between deciding and writing. A cancelled signup or a called-off
 * work order is not an assignment: both drop out through the `IS NULL`s rather
 * than through a second read.
 */
export async function setWorkTaskDoneAsAssignee(id: string, done: boolean, userId: string) {
	const [assigned] = await db
		.select({ id: workTask.id })
		.from(workTask)
		.innerJoin(workOrder, eq(workOrder.id, workTask.workOrderId))
		.innerJoin(
			volunteerSignup,
			and(eq(volunteerSignup.shiftId, workOrder.id), eq(volunteerSignup.userId, userId))
		)
		.where(
			and(eq(workTask.id, id), isNull(volunteerSignup.cancelledAt), isNull(workOrder.cancelledAt))
		)
		.limit(1);

	if (!assigned) throw new NotAssignedToShiftError();
	return setWorkTaskDone(id, done, userId);
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
