import { db } from '$lib/server/db';
import { workOrder, volunteerSignup, volunteerRole } from '$lib/server/db/schema/volunteer';
import { eventListing } from '$lib/server/db/schema/event';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	contractorJobStatusesWithoutSpend,
	DEFAULT_TIMEZONE,
	VOLUNTEER_SHIFT_MAX_CAPACITY,
	VOLUNTEER_SHIFT_MAX_MINUTES,
	VOLUNTEER_SHIFT_NOTES_MAX,
	VOLUNTEER_SHIFT_TITLE_MAX
} from '$lib/config';
import type { WorkOrder, VolunteerRoleGroup } from '$lib/server/db/schema/volunteer';
import { chunk } from '$lib/server/utils/chunk';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import type { WorkOrderField } from '$lib/types/audit';

import { getLiveSchedule, nextOccurrenceInsert } from './maintenance-schedule-service';

export { isScheduled } from './scheduled';
import { isScheduled } from './scheduled';

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------
// A dated, time-bounded need for a role. Staff create them; members claim them.
// A standing weekly slot is made by duplicating last week's; recurring
// facility work is `maintenance-schedule-service.ts`.
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

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

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
}): Promise<WorkOrder> {
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

	const [row] = await db
		.insert(workOrder)
		.values({
			volunteerRoleId: data.volunteerRoleId,
			eventId: data.eventId || null,
			assetId: data.assetId || null,
			title: validateTitle(data.title),
			startsAt: times.startsAt,
			endsAt: times.endsAt,
			capacity: validateCapacity(data.capacity),
			notes: validateNotes(data.notes),
			// A shift made this way is open to volunteers: that is what the form is.
			postedAt: new Date(),
			postedByUserId: data.createdByUserId,
			createdByUserId: data.createdByUserId
		})
		.returning();

	return row;
}

/**
 * Copy a shift forward. This is how a standing weekly slot gets made without
 * the table carrying series bookkeeping — the copy is an ordinary shift with
 * no link back, so editing or cancelling one never touches the other.
 */
export async function duplicateShift(
	id: string,
	offsetDays: number,
	createdByUserId: string
): Promise<WorkOrder> {
	const original = await getShiftById(id);
	if (!original) throw new ShiftNotFoundError();

	if (!Number.isInteger(offsetDays) || offsetDays < 1 || offsetDays > 365) {
		throw new ShiftValidationError('Copy it somewhere between tomorrow and a year out.');
	}

	// Duplication is "same shift, N days later", which needs a date to move. An
	// unscheduled work order has none — and copying one would produce a second
	// row for the same broken amp, which is a duplicate report, not a rota.
	if (!original.startsAt || !original.endsAt) {
		throw new ShiftValidationError('Give this a date before copying it forward.');
	}

	// Shift the wall-clock date, not the instant: adding 7 × 86,400,000 ms across
	// a DST boundary moves a 6pm shift to 5pm or 7pm.
	const shiftLocalDate = (d: Date) => {
		const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
		const hm = new Intl.DateTimeFormat('en-GB', {
			timeZone: TZ,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(d);
		const [y, m, day] = ymd.split('-').map(Number);
		const moved = new Date(Date.UTC(y, m - 1, day + offsetDays));
		return buildDateInTz(moved.toISOString().slice(0, 10), hm, TZ);
	};

	const startsAt = shiftLocalDate(original.startsAt);
	const endsAt = shiftLocalDate(original.endsAt);

	// Copying an old shift forward by a week usually still lands in the past, and
	// a past shift is invisible to members and unclaimable — so it would look
	// scheduled to staff while the board stayed empty.
	if (endsAt < new Date()) {
		throw new ShiftValidationError(
			'That copy would land in the past. Pick an offset that reaches a future date.'
		);
	}

	const [row] = await db
		.insert(workOrder)
		.values({
			volunteerRoleId: original.volunteerRoleId,
			// Deliberately not copied: the new date is not that event's date.
			eventId: null,
			// The title IS copied, and matters more here than anywhere: a standing
			// slot with no event is exactly what gets duplicated forward, and it is
			// the name that tells the two apart on the board.
			title: original.title,
			assetId: original.assetId,
			startsAt,
			endsAt,
			capacity: original.capacity,
			notes: original.notes,
			// Posting is a decision about this row; a copy forward of a Members
			// slot stays assigned, a copy of an open one goes on the board.
			postedAt: original.postedAt ? new Date() : null,
			postedByUserId: original.postedAt ? createdByUserId : null,
			createdByUserId
		})
		.returning();

	return row;
}

export async function updateShift(
	id: string,
	data: {
		volunteerRoleId?: string;
		eventId?: string | null;
		assetId?: string | null;
		title?: string | null;
		startsAt?: string;
		endsAt?: string;
		capacity?: number;
		notes?: string | null;
		closeReportsOnCompletion?: boolean;
	}
): Promise<WorkOrder> {
	const existing = await getShiftById(id);
	if (!existing) throw new ShiftNotFoundError();

	const startsAt = data.startsAt ? parseLocal(data.startsAt, 'Start') : existing.startsAt;
	const endsAt = data.endsAt ? parseLocal(data.endsAt, 'End') : existing.endsAt;

	// Both or neither, mirroring the table's CHECK. An unscheduled work order can
	// have its notes or capacity edited without acquiring half a window, and the
	// half-scheduled case is a bug rather than a state worth representing.
	if (startsAt && endsAt) {
		validateTimes(startsAt, endsAt);
	} else if (startsAt || endsAt) {
		throw new ShiftValidationError('Give this both a start and an end, or neither.');
	}

	// Shrinking below what's already claimed would leave people rostered onto a
	// shift that no longer has room for them.
	if (data.capacity !== undefined) {
		validateCapacity(data.capacity);
		const claimed = await countActiveSignups(id);
		if (data.capacity < claimed) {
			throw new ShiftValidationError(
				`${claimed} ${claimed === 1 ? 'person has' : 'people have'} already claimed this. ` +
					`Cancel a claim before reducing it below ${claimed}.`
			);
		}
	}

	const [row] = await db
		.update(workOrder)
		.set({
			...(data.volunteerRoleId ? { volunteerRoleId: data.volunteerRoleId } : {}),
			...(data.eventId !== undefined ? { eventId: data.eventId || null } : {}),
			...(data.assetId !== undefined ? { assetId: data.assetId || null } : {}),
			...(data.title !== undefined ? { title: validateTitle(data.title) } : {}),
			startsAt,
			endsAt,
			...(data.capacity !== undefined ? { capacity: data.capacity } : {}),
			...(data.notes !== undefined ? { notes: validateNotes(data.notes) } : {}),
			...(data.closeReportsOnCompletion !== undefined
				? { closeReportsOnCompletion: data.closeReportsOnCompletion }
				: {}),
			updatedAt: new Date()
		})
		.where(eq(workOrder.id, id))
		.returning();

	await auditWorkOrderChange(existing, row);
	return row;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;
const timing = (w: WorkOrder) => ({
	startsAt: iso(w.startsAt),
	endsAt: iso(w.endsAt),
	dueAt: iso(w.dueAt)
});

/** The label an entry keeps if the work order is later renamed or gone. */
export const workOrderAuditLabel = (w: Pick<WorkOrder, 'id' | 'title'>) => w.title ?? w.id;

/**
 * Record what an edit changed: a new time as `.rescheduled`, anything else as
 * `.edited` by field name. Every path that edits a work order calls this, so
 * the shift page and the project page write the same entries.
 */
export async function auditWorkOrderChange(before: WorkOrder, after: WorkOrder): Promise<void> {
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

/**
 * Call off a shift. The row and its signups stay: claimants still need
 * notifying, and "we cancelled that one" is worth being able to see.
 *
 * `cancelledByUserId` is what lets the cancelled shift say who called it off.
 * It is optional so the sweep-style callers a cron might grow don't have to
 * invent a user, but every staff path passes one.
 */
export async function cancelShift(id: string, cancelledByUserId?: string): Promise<WorkOrder> {
	const now = new Date();
	const cancel = db
		.update(workOrder)
		.set({ cancelledAt: now, cancelledByUserId: cancelledByUserId ?? null, updatedAt: now })
		.where(and(eq(workOrder.id, id), isNull(workOrder.cancelledAt)))
		.returning();

	// Calling off a recurring occurrence is still a close: the next one is owed.
	const schedule = await liveScheduleOf(await getShiftById(id));
	const [row] = schedule
		? (await db.batch([cancel, nextOccurrenceInsert(schedule, now)]))[0]
		: await cancel;

	if (!row) throw new ShiftNotFoundError();
	await recordAuditEntry({
		action: 'work_order.cancelled',
		subject: { type: 'work_order', id: row.id, label: workOrderAuditLabel(row) },
		details: {}
	});
	return row;
}

/** The schedule to write a next occurrence for, when closing this row owes one. */
async function liveScheduleOf(row: WorkOrder | null) {
	if (!row?.maintenanceScheduleId || row.resolvedAt || row.cancelledAt) return null;
	return getLiveSchedule(row.maintenanceScheduleId);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getShiftById(id: string): Promise<WorkOrder | null> {
	const [row] = await db.select().from(workOrder).where(eq(workOrder.id, id)).limit(1);
	return row ?? null;
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

export interface ShiftWithCounts extends WorkOrder {
	/** Null on a contractor's or not-yet-assigned work order: the role join is a left join. */
	roleName: string | null;
	roleGroup: VolunteerRoleGroup | null;
	eventTitle: string | null;
	/** The linked inventory unit as a label: item name, plus its tag. */
	assetName?: string | null;
	/** Places taken: claimed + confirmed + completed. */
	claimed: number;
	/**
	 * How many of those places are actually booked.
	 *
	 * Separate from `claimed` because only a confirmed signup gets the day-before
	 * reminder, auto-completes, and produces an hour log. A shift showing 3/3
	 * where none are confirmed is not staffed.
	 */
	confirmed: number;
	/**
	 * People on a called-off shift who still have to be told. Meaningless while
	 * `cancelledAt` is null — everybody on a live shift is trivially "unnotified".
	 */
	unnotified: number;
}

function withCounts(
	rows: {
		shift: WorkOrder;
		roleName: string | null;
		roleGroup: VolunteerRoleGroup | null;
		eventTitle: string | null;
		assetName: string | null;
		claimed: number;
		confirmed: number;
		unnotified: number;
	}[]
): ShiftWithCounts[] {
	return rows.map((r) => ({
		...r.shift,
		roleName: r.roleName,
		roleGroup: r.roleGroup,
		eventTitle: r.eventTitle,
		assetName: r.assetName,
		claimed: Number(r.claimed),
		confirmed: Number(r.confirmed),
		unnotified: Number(r.unnotified)
	}));
}

/**
 * Places taken on the work order in scope. Built from ACTIVE_SIGNUP_STATUSES
 * rather than spelled out, so a new status that holds a place can't quietly
 * stop counting.
 */
export function claimedSql() {
	const holdsAPlace = sql.join(
		ACTIVE_SIGNUP_STATUSES.map((status) => sql`${status}`),
		sql`, `
	);
	return sql<number>`(
		select count(*) from "volunteer_signup" vs
		where vs."shift_id" = ${workOrder.id}
			and vs."status" in (${holdsAPlace})
	)`;
}

/**
 * The shows among these with a live, scheduled crew shift still short of its
 * capacity: what `shifts_filled` asks. Committee-owned work is not crew.
 */
export async function eventsShortOfCrew(eventIds: string[]): Promise<Set<string>> {
	if (eventIds.length === 0) return new Set();
	const rows = await db
		.selectDistinct({ eventId: workOrder.eventId })
		.from(workOrder)
		.where(
			and(
				inArray(workOrder.eventId, eventIds),
				isNull(workOrder.groupId),
				isNotNull(workOrder.startsAt),
				isNull(workOrder.cancelledAt),
				sql`${claimedSql()} < ${workOrder.capacity}`
			)
		);
	return new Set(rows.map((r) => r.eventId!));
}

/**
 * Upcoming shifts still short of capacity, per role — the "what needs attention"
 * column on the staff roles table.
 *
 * Only roles with at least one short shift come back; read the map with `?? 0`.
 * Past and cancelled shifts are excluded: neither is something anyone can still
 * fill, and counting them would leave every role permanently red.
 */
export async function countUnfilledByRole(from = new Date()): Promise<Map<string, number>> {
	const claimed = claimedSql();

	const rows = await db
		.select({
			volunteerRoleId: workOrder.volunteerRoleId,
			unfilled: count()
		})
		.from(workOrder)
		.where(
			and(
				isNull(workOrder.cancelledAt),
				gte(workOrder.startsAt, from),
				sql`${claimed} < ${workOrder.capacity}`
			)
		)
		.groupBy(workOrder.volunteerRoleId);

	// Work with no role has no claimants to be short of; it belongs to no role's count.
	return new Map(
		rows.flatMap((r) => (r.volunteerRoleId ? [[r.volunteerRoleId, Number(r.unfilled)]] : []))
	);
}

/**
 * The shift row as every staff surface wants it: the role's name, the title of
 * the show it staffs (null for a work party), and how many places are taken.
 *
 * Both joins are `leftJoin`s and have to stay so: `eventId` and
 * `volunteerRoleId` are nullable by design, and an inner join would quietly
 * drop every work order with no show, or a contractor's or unassigned one.
 */
function shiftRowsQuery() {
	return db
		.select({
			shift: workOrder,
			roleName: volunteerRole.name,
			roleGroup: volunteerRole.group,
			eventTitle: eventListing.title,
			assetName: sql<string | null>`(
				select ii."name" || coalesce(' · ' || ia."asset_tag", '') from "inventory_asset" ia
				join "inventory_item" ii on ii."id" = ia."item_id"
				where ia."id" = ${workOrder.assetId}
			)`,
			claimed: sql<number>`(
				select count(*) from "volunteer_signup" vs
				where vs."shift_id" = ${workOrder.id}
					and vs."status" in ('claimed', 'confirmed', 'completed')
			)`,
			// `completed` counts as confirmed: the completion sweep only ever promotes a
			// confirmed signup, so a completed one WAS booked. Leaving it out would make
			// every past shift read as unconfirmed forever.
			confirmed: sql<number>`(
				select count(*) from "volunteer_signup" vs
				where vs."shift_id" = ${workOrder.id}
					and vs."status" in ('confirmed', 'completed')
			)`,
			// Zero on every live shift, and the whole story on a cancelled one:
			// there the roster is the list of people to ring, and this is what is
			// left of it. Computed here rather than in a second query because the
			// schedule needs it per cancelled row and the detail page needs it for
			// the banner, which is the same number twice.
			unnotified: sql<number>`(
				select count(*) from "volunteer_signup" vs
				where vs."shift_id" = ${workOrder.id}
					and vs."status" <> 'cancelled'
					and vs."notified_at" is null
			)`
		})
		.from(workOrder)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId));
}

/**
 * The staff list. Counts only the signups that hold a place, so a cancelled
 * claim reopens the slot rather than leaving the shift looking full.
 */
// ---------------------------------------------------------------------------
// Work orders
//
// A work order is one of these rows with no window on it yet. Everything else
// about it -- claiming, clearances, hours, no-shows, feedback -- is the shift
// machinery unchanged, which is the whole reason it is not a table of its own.
// ---------------------------------------------------------------------------

/**
 * Work that needs doing, with nobody booked to do it. Staff-created: a member's
 * `work_request` reaches one of these through a coordinator.
 *
 * With a role it is volunteer work and is posted, as queue work always was.
 * Without one it is a task typed into a project's list: nobody answers it yet,
 * so it is not posted, and its title is all it has.
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
	/** A deadline, not a window. */
	dueAt?: Date | null;
	capacity?: number;
	createdByUserId: string;
}): Promise<WorkOrder> {
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
			// Both null: the CHECK requires either a whole window or none, and this
			// is the "none" case by definition.
			startsAt: null,
			endsAt: null,
			dueAt: data.dueAt ?? null,
			capacity: validateCapacity(data.capacity ?? 1),
			notes: data.notes ? validateNotes(data.notes) : null,
			postedAt: roleId ? new Date() : null,
			postedByUserId: roleId ? data.createdByUserId : null,
			createdByUserId: data.createdByUserId
		})
		.returning();

	return row;
}

/**
 * Give a work order a window, which turns it into an ordinary claimable shift.
 *
 * `updateShift` already enforces both-or-neither and the length rules, so this
 * is a thin named path rather than a second implementation — "we found a time
 * for it" is a different story from "somebody edited the shift", and the
 * coordinator's queue needs the former.
 */
export async function scheduleWorkOrder(
	id: string,
	times: { startsAt: string; endsAt: string; closeReportsOnCompletion?: boolean }
): Promise<WorkOrder> {
	const existing = await getShiftById(id);
	if (!existing) throw new ShiftNotFoundError();
	if (existing.startsAt) {
		throw new ShiftValidationError('That is already scheduled — edit it instead.');
	}
	return updateShift(id, {
		startsAt: times.startsAt,
		endsAt: times.endsAt,
		closeReportsOnCompletion: times.closeReportsOnCompletion ?? false
	});
}

/**
 * The work is finished, which is not the same as anybody having turned up.
 *
 * `completeFinishedShifts` promotes a signup once the clock runs out; a session
 * can end with the amp still broken, so closure lives on the work row. That cron
 * keys on `ends_at` and can never reach an unscheduled row, so resolving has to
 * complete the signups itself. Does not touch the asset.
 */
export async function resolveWorkOrder(
	id: string,
	/** `override`: it has a done condition and was ticked by hand regardless. */
	opts: { resolvedByUserId: string; notes?: string | null; override?: boolean }
): Promise<WorkOrder> {
	const resolution = await prepareResolveWorkOrder(id, opts);
	const [, [row]] = await db.batch(resolution.statements);
	await resolution.afterCommit();
	return row;
}

/**
 * `resolveWorkOrder` in two halves, for a caller that commits the close in its
 * own `db.batch`: the checks and `statements` (the closing update second), and
 * `afterCommit` — the audit row and the domains that follow a resolution — to
 * run once that batch has landed.
 */
export async function prepareResolveWorkOrder(
	id: string,
	opts: { resolvedByUserId: string; notes?: string | null; override?: boolean }
) {
	const existing = await getShiftById(id);
	if (!existing) throw new ShiftNotFoundError();
	if (existing.resolvedAt) throw new ShiftValidationError('That is already closed.');
	if (existing.cancelledAt) throw new ShiftValidationError('That was called off.');

	const now = new Date();

	const completeSignups = db
		.update(volunteerSignup)
		.set({ status: 'completed', completedAt: now, updatedAt: now })
		.where(
			and(
				eq(volunteerSignup.shiftId, id),
				inArray(volunteerSignup.status, ['claimed', 'confirmed'])
			)
		);

	const close = db
		.update(workOrder)
		.set({
			resolvedAt: now,
			resolvedByUserId: opts.resolvedByUserId,
			resolutionNotes: opts.notes ?? null,
			updatedAt: now
		})
		.where(eq(workOrder.id, id))
		.returning();

	const schedule = await liveScheduleOf(existing);
	const statements = schedule
		? ([completeSignups, close, nextOccurrenceInsert(schedule, now)] as const)
		: ([completeSignups, close] as const);

	async function afterCommit() {
		await recordAuditEntry({
			action: 'work_order.resolved',
			subject: { type: 'work_order', id, label: workOrderAuditLabel(existing!) },
			details: { override: opts.override ?? false, reason: opts.notes ?? null }
		});

		// The equipment reports this work answered close with it. Dynamic, like the
		// orientation import below, so the two domains do not import each other.
		const { resolveFlagsForWorkOrder } = await import('../inventory/work-request-service');
		await resolveFlagsForWorkOrder(id, opts.resolvedByUserId, opts.notes ?? undefined);

		// Staff closing an orientation by hand is the other way one gets finished.
		// The cron path emits `volunteer.shift_completed` per signup and a listener
		// picks it up there; this path emits nothing, because the shift's clock may
		// never have run out. `completeOrientation` is `where completed_at is null`,
		// so the two racing is a no-op rather than a rewrite of who ran it.
		const { completeOrientation, orientationOwnerOf } = await import('./orientation-service');
		const member = await orientationOwnerOf(id);
		if (member) {
			await completeOrientation(member.userId, { completedByUserId: opts.resolvedByUserId });
		}
	}

	return { statements, afterCommit };
}

export interface WorkOrderQueueFilters {
	volunteerRoleId?: string;
	eventId?: string;
	projectId?: string;
}

/**
 * Which work is waiting for a time. Shared with `countVolunteerWorkWaiting`, so
 * the badge can only count rows this queue lists (#1828).
 */
export function unscheduledWorkWhere(filters: WorkOrderQueueFilters = {}) {
	return and(
		isNull(workOrder.startsAt),
		isNull(workOrder.resolvedAt),
		isNull(workOrder.cancelledAt),
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
			: and(isNull(workOrder.groupId), isNotNull(workOrder.volunteerRoleId))
	);
}

/**
 * The coordinator's queue: work nobody has found a time for.
 *
 * Oldest first, like every queue in this app — the thing that has been sitting
 * a fortnight is the one that has gone wrong.
 */
export async function listWorkOrders(
	filters: WorkOrderQueueFilters = {}
): Promise<ShiftWithCounts[]> {
	const rows = await shiftRowsQuery()
		.where(unscheduledWorkWhere(filters))
		.orderBy(asc(workOrder.createdAt), asc(workOrder.id));

	return withCounts(rows);
}

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
				// Scheduled rows only. An unscheduled row is a work order — work
				// nobody has booked a time for — and it belongs in the coordinator's
				// "needs scheduling" queue, not in a table sorted by date where it
				// would sit at one end with an empty column. `listWorkOrders` is the
				// other half of this pair.
				isNotNull(workOrder.startsAt),
				filters.includeCancelled ? undefined : isNull(workOrder.cancelledAt),
				filters.volunteerRoleId
					? eq(workOrder.volunteerRoleId, filters.volunteerRoleId)
					: undefined,
				filters.eventId ? eq(workOrder.eventId, filters.eventId) : undefined,
				filters.from ? gte(workOrder.startsAt, filters.from) : undefined,
				filters.to ? lte(workOrder.startsAt, filters.to) : undefined
			)
		)
		.orderBy(asc(workOrder.startsAt));

	return withCounts(rows).filter(isScheduled);
}

/** These work orders as list rows, whatever their state; the caller picked them. */
export async function listWorkOrdersByIds(ids: string[]): Promise<ShiftWithCounts[]> {
	if (ids.length === 0) return [];
	const rows = await shiftRowsQuery()
		.where(inArray(workOrder.id, ids))
		.orderBy(asc(workOrder.startsAt), asc(workOrder.createdAt), asc(workOrder.id));
	return withCounts(rows);
}

/**
 * One shift, with the same trimmings as a list row.
 *
 * Separate from `getShiftById`, which returns the bare table row that the signup
 * service branches on; widening it there would push the role and event joins
 * onto every claim, confirm and no-show. Cancelled shifts are included — the
 * detail page is where you go to find out what was called off.
 */
export async function getShiftDetail(id: string): Promise<ShiftWithCounts | null> {
	const rows = await shiftRowsQuery().where(eq(workOrder.id, id)).limit(1);
	return withCounts(rows)[0] ?? null;
}

/**
 * Who called a shift off, by name.
 *
 * Its own lookup rather than a join on `shiftRowsQuery`: only one page asks, and
 * only when the shift is actually cancelled. On the shared row query it would
 * join `user` a second time on every schedule row.
 */
export async function getShiftCancelledByName(shiftId: string): Promise<string | null> {
	const [row] = await db
		.select({ name: user.name })
		.from(workOrder)
		.innerJoin(user, eq(user.id, workOrder.cancelledByUserId))
		.where(eq(workOrder.id, shiftId))
		.limit(1);
	return row?.name ?? null;
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

/** An `OpenShift` the `starts_at >= now` filter already narrowed. See `isScheduled`. */
export type ScheduledOpenShift = OpenShift & { startsAt: Date; endsAt: Date };

/**
 * `unnotified` is omitted deliberately: it counts people still owed a call about
 * a shift that was called off, and this query filters cancelled shifts out
 * before they can be one. Inheriting it would put a subquery on every row of the
 * member board to answer a question that is structurally zero there.
 */
export interface OpenShift extends Omit<
	ShiftWithCounts,
	'unnotified' | 'volunteerRoleId' | 'roleName' | 'roleGroup'
> {
	/** Never null here: only posted work is listed, and posting requires a role. */
	volunteerRoleId: string;
	roleName: string;
	roleGroup: VolunteerRoleGroup;
	/** This member's own claim, if they have a live one. */
	myStatus: string | null;
	mySignupId: string | null;
	/** Empty when they can claim it. */
	missingCertifications: { id: string; name: string }[];
	isFull: boolean;
	interested: boolean;
}

/**
 * What a member sees: posted work, upcoming and live, including shifts they can't
 * take — a shift you're not cleared for is worth seeing precisely because the
 * reason tells you what to go and get. Ordered so roles they've expressed
 * interest in surface first, which is the payoff for the interest table.
 */
export async function listOpenShiftsForMember(
	userId: string,
	opts: { limit?: number } = {}
): Promise<Omit<ScheduledOpenShift, 'missingCertifications'>[]> {
	const now = new Date();

	// Built once and reused in both the select list and the ORDER BY. The
	// ranking has to be in SQL: ordering by date and re-sorting in JS after the
	// LIMIT would drop a member's own claimed shift off the board entirely once
	// more than `limit` shifts are scheduled ahead of it.
	const myStatusSql = sql<string | null>`(
		select vs."status" from "volunteer_signup" vs
		where vs."shift_id" = ${workOrder.id} and vs."user_id" = ${userId}
			and vs."status" != 'cancelled'
	)`;
	const mySignupIdSql = sql<string | null>`(
		select vs."id" from "volunteer_signup" vs
		where vs."shift_id" = ${workOrder.id} and vs."user_id" = ${userId}
			and vs."status" != 'cancelled'
	)`;
	const interestedSql = sql<number>`(
		select count(*) from "volunteer_role_interest" vri
		where vri."volunteer_role_id" = ${workOrder.volunteerRoleId}
			and vri."user_id" = ${userId}
	)`;

	// Their own commitments first — the thing they most need to see — then roles
	// they said they'd help with, then everything else.
	const rankSql = sql`case
		when ${myStatusSql} is not null then 0
		when ${interestedSql} > 0 then 1
		else 2
	end`;

	const rows = await db
		.select({
			shift: workOrder,
			roleId: volunteerRole.id,
			roleName: volunteerRole.name,
			roleGroup: volunteerRole.group,
			eventTitle: eventListing.title,
			claimed: sql<number>`(
				select count(*) from "volunteer_signup" vs
				where vs."shift_id" = ${workOrder.id}
					and vs."status" in ('claimed', 'confirmed', 'completed')
			)`,
			confirmed: sql<number>`(
				select count(*) from "volunteer_signup" vs
				where vs."shift_id" = ${workOrder.id}
					and vs."status" in ('confirmed', 'completed')
			)`,
			myStatus: myStatusSql,
			// The id comes back too, so "drop out" has something to post without a
			// second round trip per shift.
			mySignupId: mySignupIdSql,
			interested: interestedSql
		})
		.from(workOrder)
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(
			and(
				// Staff opened it to volunteers. A Members work order is scheduled
				// too, but it is staffed by assignment and is not on the board.
				isNotNull(workOrder.postedAt),
				isNull(workOrder.cancelledAt),
				gte(workOrder.startsAt, now),
				notOnCancelledListing()
			)
		)
		.orderBy(asc(rankSql), asc(workOrder.startsAt))
		.limit(opts.limit ?? 50);

	const open = rows.map((r) => ({
		...r.shift,
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

	// `starts_at >= now` already excluded unscheduled work orders. The board a
	// member browses is dated shifts; work assigned to them individually reaches
	// them through their own list, not this one.
	return open.filter(isScheduled);
}

// ---------------------------------------------------------------------------
// Assignment mode
// ---------------------------------------------------------------------------

export type WorkOrderMode = 'contractor' | 'open' | 'members' | 'unassigned';

/** The precedence on its own, so it reads (and is tested) apart from the query. */
export function deriveMode(facts: {
	engaged: boolean;
	posted: boolean;
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
					posted: sql<number>`${workOrder.postedAt} is not null`,
					// Wrapped: drizzle qualifies a column only inside a nested `sql`, and
					// a bare "id" in the subquery would resolve to the engagement's own.
					engaged: sql<number>`${liveEngagementSql()}`,
					staffed: sql<number>`${claimedSql()} > 0`
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
 * Upcoming shifts still short of people, as rows rather than a per-role count.
 *
 * `countUnfilledByRole` answers "which roles need attention" for the roles table. This
 * answers "which nights are short", which is what a dashboard panel and a coordinator
 * planning the week both want. Cancelled shifts are out — nobody can fill one of those.
 */
export async function listShortStaffedShifts(
	withinDays: number,
	from = new Date()
): Promise<RoledShift[]> {
	const to = new Date(from.getTime() + withinDays * 24 * 60 * 60 * 1000);
	const rows = await listShifts({ from, to });
	// A window was passed, so `listShifts` already dropped the undated rows —
	// "which nights are short" is a question only a dated shift can answer.
	// Work with no role is nobody's to fill, so it is never short of people.
	return rows.filter(isRoledShift).filter((shift) => shift.claimed < shift.capacity);
}
