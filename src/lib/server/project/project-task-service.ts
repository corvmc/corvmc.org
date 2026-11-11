import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { isUniqueConstraintError } from '#lib/server/db/constraint-errors.js';
import {
	contractorJobStatusesWithoutSpend,
	positions,
	type ContractorJobStatus
} from '#lib/config.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { role, modelHasRole } from '#lib/server/db/schema/authorization.js';
import { group, groupMember } from '#lib/server/db/schema/group.js';
import { inventoryAsset, inventoryItem } from '#lib/server/db/schema/inventory.js';
import { contractor, contractorJob } from '#lib/server/db/schema/contractor.js';
import { projectCommittee } from '#lib/server/db/schema/project.js';
import {
	volunteerRole,
	volunteerShift,
	volunteerSignup,
	dutyList,
	workOrder,
	workOrderAssignee,
	workTask,
	type Task
} from '#lib/server/db/schema/volunteer.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { DomainError } from '#lib/server/domain-error.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { evaluateDone, type DeliverableState } from '#lib/server/volunteer/done-conditions.js';
import {
	auditWorkOrderChange,
	cancelLiveShifts,
	cancelShift,
	capacitySql,
	claimedSql,
	createWorkOrder,
	getCurrentShift,
	requireActiveRole,
	resolveWorkOrder,
	toTask,
	updateShift,
	validateCapacity,
	workOrderModes,
	type WorkOrderMode
} from '#lib/server/volunteer/work-order-service.js';
import { releaseSignup } from '#lib/server/volunteer/volunteer-signup-service.js';
import {
	assignToTask,
	removeAllAssignees,
	unassignFromTask
} from '#lib/server/volunteer/assignee-service.js';
import { setWorkTaskDone } from '#lib/server/volunteer/duty-list-service.js';
import { cancelJob, createJob } from '#lib/server/contractor/contractor-job-service.js';
import {
	listSections,
	nextTaskOrders,
	requireSection
} from '#lib/server/project/project-section-service.js';
import {
	dutiesOn,
	engagementsOn,
	outstandingFor,
	peopleOn
} from '#lib/server/project/project-task-details.js';

// ---------------------------------------------------------------------------
// A project's task list: the work orders on it, as a checklist. Every function
// takes the project id and refuses a work order that is not on that project,
// because a remote takes both ids from the client.
// ---------------------------------------------------------------------------

export class TaskNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Task not found');
	}
}

export class TaskValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

export class TaskConflictError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
	}
}

const FINISHED = 'A contractor did this work and its cost is on the record, so it stays theirs.';

/** The work order, refused (404) unless it belongs to this project. */
export async function requireTaskInProject(projectId: string, workOrderId: string): Promise<Task> {
	const [row] = await db
		.select()
		.from(workOrder)
		.where(and(eq(workOrder.id, workOrderId), eq(workOrder.projectId, projectId)))
		.limit(1);
	if (!row) throw new TaskNotFoundError();
	return toTask(row);
}

async function requireLiveTask(projectId: string, workOrderId: string): Promise<Task> {
	const task = await requireTaskInProject(projectId, workOrderId);
	if (task.cancelledAt) throw new TaskConflictError('That task was called off.');
	return task;
}

const label = (task: Pick<Task, 'id' | 'title'>) => task.title ?? task.id;

async function modeOf(id: string): Promise<WorkOrderMode> {
	return (await workOrderModes([id])).get(id) ?? 'unassigned';
}

async function auditModeChange(
	task: Task,
	from: WorkOrderMode,
	to: WorkOrderMode,
	cancelledSignups = 0,
	called: OpenEngagement[] = []
) {
	if (from === to && cancelledSignups === 0) return;
	const calledOff = called.map((e) => e.contractorName).join(', ');
	await recordAuditEntry({
		action: 'work_order.assigned',
		subject: { type: 'work_order', id: task.id, label: label(task) },
		details: { from, to, cancelledSignups, ...(calledOff ? { calledOff } : {}) }
	});
}

/** A switch the caller has to confirm: who it would take off, and whose engagement it cancels. */
export interface SwitchWarning {
	status: 'needs_confirmation';
	liveSignups: number;
	engagement: { contractorName: string; status: ContractorJobStatus } | null;
}

interface OpenEngagement {
	id: string;
	status: ContractorJobStatus;
	contractorName: string;
}

/**
 * What a switch away from Contractor cancels: the engagement still asked or
 * booked. Refused once one has completed, since that work is done and paid for.
 */
async function engagementsToCancel(task: Task, from: WorkOrderMode) {
	if (from !== 'contractor') return [];
	const rows: OpenEngagement[] = await db
		.select({
			id: contractorJob.id,
			status: contractorJob.status,
			contractorName: contractor.name
		})
		.from(contractorJob)
		.innerJoin(contractor, eq(contractor.id, contractorJob.contractorId))
		.where(
			and(
				eq(contractorJob.workOrderId, task.id),
				sql`${contractorJob.status} not in (${sql.join(
					contractorJobStatusesWithoutSpend.map((st) => sql`${st}`),
					sql`, `
				)})`
			)
		);
	if (rows.some((r) => r.status === 'completed')) throw new TaskConflictError(FINISHED);
	return rows;
}

function warning(liveSignups: number, open: OpenEngagement[]): SwitchWarning {
	const [first] = open;
	return {
		status: 'needs_confirmation',
		liveSignups,
		engagement: first ? { contractorName: first.contractorName, status: first.status } : null
	};
}

/** Through the engagement's own Cancel, which leaves a unit out of service. */
async function cancelEngagements(open: OpenEngagement[]) {
	for (const e of open) await cancelJob(e.id);
}

// ---------------------------------------------------------------------------
// Create, order, move
// ---------------------------------------------------------------------------

/** A line typed into the list: a title, at the end of its section, nothing else set. */
export async function createTask(data: {
	projectId: string;
	title: string;
	sectionId?: string | null;
	createdByUserId: string;
}): Promise<Task> {
	const sectionId = data.sectionId || null;
	if (sectionId) await requireSection(data.projectId, sectionId);
	if (!data.title.trim()) throw new TaskValidationError('Give the task a title.');
	const order = (await nextTaskOrders(data.projectId)).get(sectionId) ?? 0;
	const row = await createWorkOrder({
		title: data.title,
		projectId: data.projectId,
		sectionId,
		sortOrder: order,
		createdByUserId: data.createdByUserId
	});
	await recordAuditEntry({
		action: 'work_order.created',
		subject: { type: 'work_order', id: row.id, label: label(row) },
		details: { projectId: data.projectId, title: row.title ?? '' }
	});
	return row;
}

function sectionIs(sectionId: string | null) {
	return sectionId ? eq(workOrder.sectionId, sectionId) : isNull(workOrder.sectionId);
}

async function tasksIn(projectId: string, sectionId: string | null, except?: string) {
	return db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(
			and(
				eq(workOrder.projectId, projectId),
				sectionIs(sectionId),
				except ? ne(workOrder.id, except) : undefined
			)
		)
		.orderBy(asc(workOrder.sortOrder), asc(workOrder.createdAt), asc(workOrder.id));
}

/** Write `ids` as positions 0..n in `sectionId`, in one batch. */
async function writeOrder(ids: string[], sectionId: string | null) {
	if (ids.length === 0) return;
	const now = new Date();
	await db.batch(
		ids.map((id, i) =>
			db
				.update(workOrder)
				.set({ sectionId, sortOrder: i, updatedAt: now })
				.where(eq(workOrder.id, id))
		) as unknown as Parameters<typeof db.batch>[0]
	);
}

/**
 * Put a task at `index` in a section (null: the unlabelled group), renumbering
 * that section so positions stay 0..n. The section it left keeps its gaps,
 * which order the same.
 */
export async function moveTask(
	projectId: string,
	workOrderId: string,
	to: { sectionId: string | null; index: number }
): Promise<void> {
	const task = await requireTaskInProject(projectId, workOrderId);
	if (to.sectionId) await requireSection(projectId, to.sectionId);
	const ids = (await tasksIn(projectId, to.sectionId, workOrderId)).map((r) => r.id);
	const at = Math.max(0, Math.min(Math.trunc(to.index), ids.length));
	ids.splice(at, 0, workOrderId);
	await writeOrder(ids, to.sectionId);

	if (task.sectionId !== to.sectionId) {
		await recordAuditEntry({
			action: 'work_order.moved',
			subject: { type: 'work_order', id: task.id, label: label(task) },
			details: { fromSectionId: task.sectionId, toSectionId: to.sectionId }
		});
	}
}

/** `orderedIds` must name every task in the section exactly once. */
export async function reorderTasks(
	projectId: string,
	sectionId: string | null,
	orderedIds: string[]
): Promise<void> {
	if (sectionId) await requireSection(projectId, sectionId);
	const current = new Set((await tasksIn(projectId, sectionId)).map((r) => r.id));
	if (
		orderedIds.length !== current.size ||
		new Set(orderedIds).size !== orderedIds.length ||
		orderedIds.some((id) => !current.has(id))
	) {
		throw new TaskValidationError('The list changed while you were moving it. Reload.');
	}
	await writeOrder(orderedIds, sectionId);
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export interface AssignableMember {
	userId: string;
	name: string;
	via: 'staff' | 'committee';
}

/** The committee answerable for the task: its own, else its project's owner. */
async function committeeOf(task: Task): Promise<string | null> {
	if (task.groupId) return task.groupId;
	if (!task.projectId) return null;
	const [owner] = await db
		.select({ groupId: projectCommittee.groupId })
		.from(projectCommittee)
		.where(and(eq(projectCommittee.projectId, task.projectId), eq(projectCommittee.role, 'owner')))
		.limit(1);
	return owner?.groupId ?? null;
}

async function assignableTo(task: Task): Promise<AssignableMember[]> {
	const committeeId = await committeeOf(task);
	const [staff, committee] = await Promise.all([
		db
			.selectDistinct({ userId: user.id, name: user.name })
			.from(user)
			.innerJoin(modelHasRole, eq(modelHasRole.userId, user.id))
			.innerJoin(role, eq(role.id, modelHasRole.roleId))
			.where(inArray(role.name, Object.keys(positions))),
		committeeId
			? db
					.select({ userId: user.id, name: user.name })
					.from(groupMember)
					.innerJoin(user, eq(user.id, groupMember.userId))
					.where(and(eq(groupMember.groupId, committeeId), eq(groupMember.status, 'active')))
			: Promise.resolve([])
	]);
	const byId = new Map<string, AssignableMember>();
	for (const s of staff) byId.set(s.userId, { ...s, via: 'staff' });
	for (const c of committee)
		if (!byId.has(c.userId)) byId.set(c.userId, { ...c, via: 'committee' });
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Who the picker lists: staff, and the members of the task's committee. */
export async function listAssignableMembers(
	projectId: string,
	workOrderId: string
): Promise<AssignableMember[]> {
	return assignableTo(await requireTaskInProject(projectId, workOrderId));
}

/** Live sign-ups on the task's shifts that have not ended: who a switch takes off. */
async function liveSignupsOn(workOrderId: string) {
	return db
		.select({ id: volunteerSignup.id, userId: volunteerSignup.userId })
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.where(
			and(
				eq(volunteerShift.workOrderId, workOrderId),
				isNull(volunteerShift.cancelledAt),
				gt(volunteerShift.endsAt, new Date()),
				inArray(volunteerSignup.status, ['claimed', 'confirmed'])
			)
		);
}

async function assigneesOf(workOrderId: string) {
	return db
		.select({ userId: workOrderAssignee.userId })
		.from(workOrderAssignee)
		.where(eq(workOrderAssignee.workOrderId, workOrderId));
}

/**
 * Take everybody off the task: assignees removed, sign-ups on shifts still to
 * come released (which tells each person), and those shifts called off.
 */
async function takeEveryoneOff(task: Task, by: string | null, signups: { id: string }[]) {
	for (const s of signups) await releaseSignup(s.id);
	const now = new Date();
	await db.batch([
		removeAllAssignees(task.id),
		db
			.update(volunteerShift)
			.set({ cancelledAt: now, cancelledByUserId: by, updatedAt: now })
			.where(
				and(
					eq(volunteerShift.workOrderId, task.id),
					isNull(volunteerShift.cancelledAt),
					gt(volunteerShift.endsAt, now)
				)
			)
	]);
}

/** The role the task will run under: the one given, else its own. Required for volunteer work. */
async function roleFor(task: Task, volunteerRoleId?: string | null): Promise<string> {
	const roleId = volunteerRoleId || task.volunteerRoleId;
	if (!roleId) throw new TaskValidationError('Pick a role first: hours are logged against it.');
	if (roleId !== task.volunteerRoleId) await requireActiveRole(roleId);
	return roleId;
}

export interface AssignResult {
	status: 'done';
	assigned: string[];
	/** People refused, with the reason (a profile awaiting review, …). */
	refused: { userId: string; message: string }[];
	/** People assigned over warnings (no volunteer profile, a missing clearance); recorded in the log. */
	warned: { userId: string; warnings: string[] }[];
	mode: WorkOrderMode;
}

/**
 * Assign named people to the task (#2518): `work_order_assignee` rows, never
 * sign-ups. Its shifts and anyone signed up for them stay. A role is still
 * required, because assignees log their hours against it.
 * From a contractor, the first call warns and `confirm` cancels the engagement.
 */
export async function assignMembers(
	projectId: string,
	workOrderId: string,
	data: {
		userIds: string[];
		volunteerRoleId?: string | null;
		confirm?: boolean;
		assignedByUserId?: string | null;
	}
): Promise<AssignResult | SwitchWarning> {
	const task = await requireLiveTask(projectId, workOrderId);
	const from = await modeOf(task.id);
	const open = await engagementsToCancel(task, from);
	const roleId = await roleFor(task, data.volunteerRoleId);

	const allowed = new Set((await assignableTo(task)).map((m) => m.userId));
	const wanted = [...new Set(data.userIds)];
	if (wanted.some((id) => !allowed.has(id))) {
		throw new TaskValidationError('Only staff and members of its committee can be assigned.');
	}
	const onIt = new Set((await assigneesOf(task.id)).map((a) => a.userId));
	const adding = wanted.filter((id) => !onIt.has(id));
	if (adding.length === 0 && onIt.size === 0) {
		throw new TaskValidationError('Pick at least one person.');
	}
	if (open.length > 0 && !data.confirm) return warning(0, open);
	await cancelEngagements(open);

	if (roleId !== task.volunteerRoleId) {
		await db
			.update(workOrder)
			.set({ volunteerRoleId: roleId, updatedAt: new Date() })
			.where(eq(workOrder.id, task.id));
	}

	const assigned: string[] = [];
	const refused: AssignResult['refused'] = [];
	const warned: AssignResult['warned'] = [];
	const target = { ...task, volunteerRoleId: roleId };
	for (const userId of adding) {
		try {
			const { warnings } = await assignToTask(target, userId, data.assignedByUserId ?? null);
			assigned.push(userId);
			if (warnings.length > 0) warned.push({ userId, warnings });
		} catch (err) {
			if (!(err instanceof DomainError)) throw err;
			refused.push({ userId, message: err.message });
		}
	}

	const mode = await modeOf(task.id);
	await auditModeChange(task, from, mode, 0, open);
	return { status: 'done', assigned, refused, warned, mode };
}

/**
 * Take one person off the task: their assignment, or else their sign-up on one
 * of its shifts still to come, released the way a dropped shift is.
 */
export async function unassignMember(
	projectId: string,
	workOrderId: string,
	userId: string
): Promise<void> {
	const task = await requireLiveTask(projectId, workOrderId);
	const from = await modeOf(task.id);
	if (!(await unassignFromTask(task, userId))) {
		const [signup] = (await liveSignupsOn(task.id)).filter((s) => s.userId === userId);
		if (!signup) throw new TaskNotFoundError();
		await releaseSignup(signup.id);
	}
	await auditModeChange(task, from, await modeOf(task.id));
}

/**
 * Set the role and places of the task's shift (#2518). A shift is what is open
 * to volunteers, and it needs a time: a task with none is given one through
 * Reschedule, which opens it. Anybody already on it stays on it.
 */
export async function openToVolunteers(
	projectId: string,
	workOrderId: string,
	data: {
		volunteerRoleId?: string | null;
		capacity?: number;
		postedByUserId: string;
		confirm?: boolean;
	}
): Promise<{ status: 'done'; mode: WorkOrderMode } | SwitchWarning> {
	const task = await requireLiveTask(projectId, workOrderId);
	const from = await modeOf(task.id);
	const open = await engagementsToCancel(task, from);
	const roleId = await roleFor(task, data.volunteerRoleId);
	const shift = await getCurrentShift(task.id);
	if (!shift || shift.cancelledAt) {
		throw new TaskValidationError(
			'Give it a time first: volunteers sign up for a shift, and a shift has a start and an end.'
		);
	}
	const capacity = validateCapacity(data.capacity ?? shift.capacity);
	if (open.length > 0 && !data.confirm) return warning(0, open);
	await cancelEngagements(open);
	// `updateShift` refuses fewer places than are already taken.
	await updateShift(task.id, { volunteerRoleId: roleId, capacity });
	const mode = await modeOf(task.id);
	await auditModeChange(task, from, mode, 0, open);
	return { status: 'done', mode };
}

export type UnassignResult =
	SwitchWarning | { status: 'done'; cancelledSignups: number; mode: WorkOrderMode };

/**
 * Nobody answers it. Warn, record, allow: with people on it, the first call
 * only says how many; with `confirm`, their signups are cancelled through the
 * ordinary release, which tells each of them.
 */
export async function unassignTask(
	projectId: string,
	workOrderId: string,
	data: { confirm?: boolean; byUserId?: string | null } = {}
): Promise<UnassignResult> {
	const task = await requireLiveTask(projectId, workOrderId);
	const from = await modeOf(task.id);
	const open = await engagementsToCancel(task, from);
	const live = await liveSignupsOn(task.id);
	const people = live.length + (await assigneesOf(task.id)).length;
	if ((people > 0 || open.length > 0) && !data.confirm) return warning(people, open);

	await cancelEngagements(open);
	await takeEveryoneOff(task, data.byUserId ?? null, live);
	const mode = await modeOf(task.id);
	await auditModeChange(task, from, mode, live.length, open);
	return { status: 'done', cancelledSignups: live.length, mode };
}

export type EngageResult =
	| SwitchWarning
	| { status: 'done'; engagementId: string; cancelledSignups: number; mode: WorkOrderMode };

/**
 * Delegate the task: a contractor's engagement on it, asked. Takes it off the
 * claim board. Warn, record, allow: with people on it the first call only says
 * how many; with `confirm` their signups are cancelled, which tells them.
 */
export async function engageContractor(
	projectId: string,
	workOrderId: string,
	data: {
		contractorId: string;
		quotedCents?: number | null;
		requestedByUserId: string;
		confirm?: boolean;
	}
): Promise<EngageResult> {
	const task = await requireLiveTask(projectId, workOrderId);
	if (task.resolvedAt) throw new TaskConflictError('That task is already done.');
	const from = await modeOf(task.id);
	const live = await liveSignupsOn(task.id);
	const people = live.length + (await assigneesOf(task.id)).length;
	if (people > 0 && !data.confirm) return warning(people, []);

	// The engagement first: it refuses an archived contractor before anything moves.
	const job = await createJob({
		workOrderId: task.id,
		contractorId: data.contractorId,
		quotedCents: data.quotedCents ?? null,
		requestedByUserId: data.requestedByUserId
	});
	// Delegating cancels its shifts still to come and removes its assignees (#2518).
	await takeEveryoneOff(task, data.requestedByUserId, live);
	const mode = await modeOf(task.id);
	await auditModeChange(task, from, mode, live.length);
	return { status: 'done', engagementId: job.id, cancelledSignups: live.length, mode };
}

// ---------------------------------------------------------------------------
// Duties and equipment
// ---------------------------------------------------------------------------

/** A duty under the task, at the end of its list. */
export async function addDuty(projectId: string, workOrderId: string, label: string) {
	const task = await requireLiveTask(projectId, workOrderId);
	const text = label.trim();
	if (!text) throw new TaskValidationError('Say what the duty is.');
	const [last] = await db
		.select({ n: sql<number>`coalesce(max(${workTask.sortOrder}), -1)` })
		.from(workTask)
		.where(eq(workTask.workOrderId, task.id));
	const [row] = await db
		.insert(workTask)
		.values({ workOrderId: task.id, label: text, sortOrder: Number(last?.n ?? -1) + 1 })
		.returning();
	return row;
}

/** Tick or untick a duty, refused (404) unless it is this task's. */
export async function setDutyDone(
	projectId: string,
	workOrderId: string,
	dutyId: string,
	done: boolean,
	userId: string
) {
	const task = await requireTaskInProject(projectId, workOrderId);
	const [duty] = await db
		.select({ id: workTask.id })
		.from(workTask)
		.where(and(eq(workTask.id, dutyId), eq(workTask.workOrderId, task.id)))
		.limit(1);
	if (!duty) throw new TaskNotFoundError();
	return setWorkTaskDone(duty.id, done, userId);
}

/** The unit the task is about, or none. */
export async function setTaskEquipment(
	projectId: string,
	workOrderId: string,
	assetId: string | null
): Promise<void> {
	const task = await requireLiveTask(projectId, workOrderId);
	if (assetId) {
		const [asset] = await db
			.select({ id: inventoryAsset.id })
			.from(inventoryAsset)
			.where(eq(inventoryAsset.id, assetId))
			.limit(1);
		if (!asset) throw new TaskValidationError('That unit does not exist.');
	}
	const [row] = await db
		.update(workOrder)
		.set({ assetId, updatedAt: new Date() })
		.where(eq(workOrder.id, task.id))
		.returning();
	await auditWorkOrderChange(task, toTask(row));
}

// ---------------------------------------------------------------------------
// Done, reopened, rescheduled, called off
// ---------------------------------------------------------------------------

/**
 * Tick it. A task with a done condition is the app's to tick, so ticking one by
 * hand is an override: it needs a reason, kept as the resolution notes.
 */
export async function resolveTask(
	projectId: string,
	workOrderId: string,
	data: { resolvedByUserId: string; reason?: string | null }
): Promise<Task> {
	const task = await requireLiveTask(projectId, workOrderId);
	const reason = data.reason?.trim() || null;
	if (task.doneWhen !== null && !reason) {
		throw new TaskValidationError(
			'This one ticks itself when its condition holds. Say why it is done regardless.'
		);
	}
	return resolveWorkOrder(task.id, { resolvedByUserId: data.resolvedByUserId, notes: reason });
}

/** Untick it. A task with a done condition goes back to reading it. */
export async function reopenTask(projectId: string, workOrderId: string): Promise<Task> {
	const task = await requireLiveTask(projectId, workOrderId);
	if (!task.resolvedAt) throw new TaskConflictError('That task is not ticked.');
	try {
		const [row] = await db
			.update(workOrder)
			.set({
				resolvedAt: null,
				resolvedByUserId: null,
				resolutionNotes: null,
				updatedAt: new Date()
			})
			.where(eq(workOrder.id, task.id))
			.returning();
		await recordAuditEntry({
			action: 'work_order.reopened',
			subject: { type: 'work_order', id: task.id, label: label(task) },
			details: {}
		});
		return toTask(row);
	} catch (err) {
		// A recurring occurrence: closing it already wrote the next one.
		if (isUniqueConstraintError(err)) {
			throw new TaskConflictError('The next occurrence of this is already open. Work on that one.');
		}
		throw err;
	}
}

/**
 * Set the shift's time (`YYYY-MM-DDTHH:mm`, club time; both or neither) and the
 * deadline. Times edit the task's current shift or open one; clearing them
 * calls its live shift off, so a task can lose its time as well as gain one.
 */
export async function rescheduleTask(
	projectId: string,
	workOrderId: string,
	data: {
		startsAt: string | null;
		endsAt: string | null;
		dueAt: Date | null;
		byUserId?: string | null;
	}
): Promise<Task> {
	const task = await requireLiveTask(projectId, workOrderId);
	if (!data.startsAt !== !data.endsAt) {
		throw new TaskValidationError('Give this both a start and an end, or neither.');
	}
	const current = await getCurrentShift(task.id);
	const live = current && !current.cancelledAt ? current : null;
	if (data.startsAt && data.endsAt) {
		await updateShift(task.id, {
			startsAt: data.startsAt,
			endsAt: data.endsAt,
			updatedByUserId: data.byUserId ?? undefined
		});
	} else if (live) {
		await cancelLiveShifts(task.id, data.byUserId ?? null, new Date());
		await auditWorkOrderChange(
			{ ...task, startsAt: live.startsAt, endsAt: live.endsAt },
			{ ...task, startsAt: null, endsAt: null }
		);
	}
	const [row] = await db
		.update(workOrder)
		.set({ dueAt: data.dueAt, updatedAt: new Date() })
		.where(eq(workOrder.id, task.id))
		.returning();
	const after = toTask(row);
	await auditWorkOrderChange(task, after);
	return after;
}

/** Call it off. Its signups stay, as a notify list, exactly as a cancelled shift's do. */
export async function cancelTask(
	projectId: string,
	workOrderId: string,
	cancelledByUserId: string
): Promise<Task> {
	const task = await requireLiveTask(projectId, workOrderId);
	return cancelShift(task.id, cancelledByUserId);
}

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

export interface Progress {
	done: number;
	total: number;
}

/** Done over live: every mode counts, cancelled ones do not, and done is `evaluateDone`'s. */
function progressOf(states: Map<string, DeliverableState>): Progress {
	let done = 0;
	let total = 0;
	for (const s of states.values()) {
		if (s === 'cancelled') continue;
		total += 1;
		if (s === 'done') done += 1;
	}
	return { done, total };
}

const doneInputColumns = {
	id: workOrder.id,
	eventId: workOrder.eventId,
	doneWhen: workOrder.doneWhen,
	resolvedAt: workOrder.resolvedAt,
	cancelledAt: workOrder.cancelledAt,
	dueAt: workOrder.dueAt
};

export async function getProjectProgress(projectId: string): Promise<Progress> {
	const rows = await db
		.select(doneInputColumns)
		.from(workOrder)
		.where(and(eq(workOrder.projectId, projectId), isNull(workOrder.cancelledAt)));
	return progressOf(await evaluateDone(rows));
}

/** `getProjectProgress` for many projects in one query, keyed by project id. */
export async function listProjectProgress(projectIds: string[]): Promise<Map<string, Progress>> {
	const out = new Map<string, Progress>(projectIds.map((id) => [id, { done: 0, total: 0 }]));
	if (projectIds.length === 0) return out;
	const rows = await db
		.select({ ...doneInputColumns, projectId: workOrder.projectId })
		.from(workOrder)
		.where(and(inArray(workOrder.projectId, projectIds), isNull(workOrder.cancelledAt)));
	const states = await evaluateDone(rows);
	for (const r of rows) {
		const p = out.get(r.projectId!);
		const s = states.get(r.id);
		if (!p || s === 'cancelled') continue;
		p.total += 1;
		if (s === 'done') p.done += 1;
	}
	return out;
}

/** The project's owning committee, which a task with none of its own answers to. */
async function owningCommittee(projectId: string) {
	const [row] = await db
		.select({ id: group.id, name: group.name })
		.from(projectCommittee)
		.innerJoin(group, eq(group.id, projectCommittee.groupId))
		.where(and(eq(projectCommittee.projectId, projectId), eq(projectCommittee.role, 'owner')))
		.limit(1);
	return row ?? null;
}

/** Everything the task list draws: sections, each task with its mode and state, and progress. */
/** One time of the task's latest live shift, or null with none. */
function liveShiftTime(column: 'starts_at' | 'ends_at') {
	return sql<Date | null>`(
		select s.${sql.raw(`"${column}"`)} from "volunteer_shift" s
		where s."work_order_id" = ${workOrder.id} and s."cancelled_at" is null
		order by s."starts_at" desc limit 1
	)`.mapWith((v: number | null) => (v === null ? null : new Date(Number(v) * 1000)));
}

export async function listProjectTasks(projectId: string) {
	const [sections, rows, committee] = await Promise.all([
		listSections(projectId),
		db
			.select({
				...doneInputColumns,
				title: sql<string>`coalesce(${workOrder.title}, ${eventListing.title}, ${volunteerRole.name}, 'Untitled task')`,
				sectionId: workOrder.sectionId,
				sortOrder: workOrder.sortOrder,
				volunteerRoleId: workOrder.volunteerRoleId,
				roleName: volunteerRole.name,
				// Across the task's live shifts; with none, the places it asked for.
				capacity:
					sql<number>`coalesce(nullif(${capacitySql()}, 0), ${workOrder.pendingCapacity}, 1)`.mapWith(
						Number
					),
				claimed: claimedSql().mapWith(Number),
				// The latest live shift's time, which is what a one-shift row shows.
				startsAt: liveShiftTime('starts_at'),
				endsAt: liveShiftTime('ends_at'),
				groupId: workOrder.groupId,
				groupName: group.name,
				notes: workOrder.notes,
				resolutionNotes: workOrder.resolutionNotes,
				eventTitle: eventListing.title,
				assetId: workOrder.assetId,
				assetName: inventoryItem.name,
				assetTag: inventoryAsset.assetTag,
				assetStatus: inventoryAsset.status,
				dutyListId: workOrder.dutyListId,
				dutyListName: dutyList.name
			})
			.from(workOrder)
			.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
			.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
			.leftJoin(group, eq(group.id, workOrder.groupId))
			.leftJoin(inventoryAsset, eq(inventoryAsset.id, workOrder.assetId))
			.leftJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
			.leftJoin(dutyList, eq(dutyList.id, workOrder.dutyListId))
			.where(eq(workOrder.projectId, projectId))
			.orderBy(asc(workOrder.sortOrder), asc(workOrder.createdAt), asc(workOrder.id)),
		owningCommittee(projectId)
	]);
	const ids = rows.map((r) => r.id);
	const [modes, states, people, engagements, duties] = await Promise.all([
		workOrderModes(ids),
		evaluateDone(rows),
		peopleOn(ids),
		engagementsOn(ids),
		dutiesOn(ids)
	]);
	const tasks = rows.map((r) => {
		const items = duties.get(r.id) ?? [];
		return {
			...r,
			mode: modes.get(r.id) ?? 'unassigned',
			state: states.get(r.id) ?? 'open',
			people: people.get(r.id) ?? [],
			engagement: engagements.get(r.id) ?? null,
			dutyItems: items,
			duties: { done: items.filter((d) => d.done).length, total: items.length }
		};
	});
	const outstanding = await outstandingFor(tasks);
	return {
		sections,
		committee,
		tasks: tasks.map((t) => ({ ...t, outstanding: outstanding.get(t.id) ?? null })),
		progress: progressOf(states)
	};
}

/**
 * The task list as a caller sees it: who is engaged stays (a committee
 * delegates its own tasks), what they quoted, cost and invoiced only with
 * `contractor.read`, which the remote decides and passes in.
 */
export function scopeContractorMoney(list: ProjectTaskList, contractorMoney: boolean) {
	if (contractorMoney) return { ...list, contractorMoney };
	const tasks = list.tasks.map((t) => ({
		...t,
		engagement: t.engagement && {
			...t.engagement,
			quotedCents: null,
			costCents: null,
			isDonated: false,
			fairValueCents: null,
			invoiceRef: null,
			paidAt: null
		}
	}));
	return { ...list, tasks, contractorMoney };
}

export type ProjectTaskList = Awaited<ReturnType<typeof listProjectTasks>>;
export type ProjectTask = ProjectTaskList['tasks'][number];
