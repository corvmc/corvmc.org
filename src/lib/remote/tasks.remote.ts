import { z } from 'zod';
import { query } from '$app/server';
import { command, form } from './_remote';
import { can, requireUser } from '$lib/server/authorization';
import { requireProjectCommittee } from '$lib/server/group/group-context';
import { mapDomainError } from '$lib/server/errors';
import { DEFAULT_TIMEZONE, VOLUNTEER_SHIFT_TITLE_MAX } from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { getProjectById } from '$lib/server/project/project-service';
import { getProjectDetail } from './projects.remote';
import {
	createSection,
	deleteSection,
	renameSection,
	reorderSections
} from '$lib/server/project/project-section-service';
import {
	addDuty,
	assignMembers,
	cancelTask,
	createTask,
	engageContractor,
	listAssignableMembers,
	listProjectTasks,
	moveTask,
	openToVolunteers,
	reopenTask,
	reorderTasks,
	requireTaskInProject,
	rescheduleTask,
	resolveTask,
	setDutyDone,
	setTaskEquipment,
	unassignMember,
	unassignTask
} from '$lib/server/project/project-task-service';
import { listVolunteerRoles } from '$lib/server/volunteer/volunteer-role-service';
import { listContractors } from '$lib/server/contractor/contractor-service';

/**
 * A project's task list: its work orders as a checklist, with sections.
 *
 * Every write is the project's committee (`project.manage` carries) or staff
 * holding it, as applying a duty list is. Both ids come from the client, so a
 * remote naming a work order loads it and 404s unless it is on that project.
 */

const projectId = z.uuid();
const workOrderId = z.string().min(1);
const sectionId = z.string().min(1);
/** A cleared `select` posts `''`. */
const optionalId = z.union([z.literal(''), z.string().min(1)]).optional();

// Mapped here as well as by `_remote`, so the read queries share the helpers.
async function guardProject(id: string) {
	requireUser();
	try {
		await getProjectById(id);
	} catch (err) {
		mapDomainError(err);
	}
	return requireProjectCommittee(id, 'project.manage');
}

async function guardTask(projectId: string, workOrderId: string) {
	const guard = await guardProject(projectId);
	try {
		await requireTaskInProject(projectId, workOrderId);
	} catch (err) {
		mapDomainError(err);
	}
	return guard;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const getProjectTasks = query(projectId, async (id) => {
	requireUser();
	try {
		await getProjectById(id);
		if (!(await can('project.read'))) await requireProjectCommittee(id, 'project.manage');
		return await listProjectTasks(id);
	} catch (err) {
		mapDomainError(err);
	}
});

/** What the assignment picker offers for one task: people, roles and contractors. */
export const getTaskAssignees = query(
	z.object({ projectId, workOrderId }),
	async ({ projectId, workOrderId }) => {
		try {
			await guardTask(projectId, workOrderId);
			const [members, roles, contractors] = await Promise.all([
				listAssignableMembers(projectId, workOrderId),
				listVolunteerRoles(),
				listContractors()
			]);
			return {
				members,
				roles: roles.map((r) => ({ id: r.id, name: r.name })),
				contractors: contractors.map((c) => ({ id: c.id, name: c.name, trade: c.trade }))
			};
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** The staff page reads the list through its one query; a committee member cannot run it. */
async function refresh(id: string) {
	if (await can('project.read')) void getProjectDetail(id).refresh();
}

// ---------------------------------------------------------------------------
// Ordering, by drag
// ---------------------------------------------------------------------------

export const reorderSectionsCommand = command(
	z.object({ projectId, sectionIds: z.array(sectionId).max(200) }),
	async (data) => {
		await guardProject(data.projectId);
		await reorderSections(data.projectId, data.sectionIds);
		await refresh(data.projectId);
	}
);

/** Drop a task at `index` in a section; `sectionId: null` is the unlabelled group. */
export const moveTaskCommand = command(
	z.object({
		projectId,
		workOrderId,
		sectionId: sectionId.nullable(),
		index: z.number().int().min(0)
	}),
	async (data) => {
		await guardTask(data.projectId, data.workOrderId);
		await moveTask(data.projectId, data.workOrderId, {
			sectionId: data.sectionId,
			index: data.index
		});
		await refresh(data.projectId);
	}
);

export const reorderTasksCommand = command(
	z.object({
		projectId,
		sectionId: sectionId.nullable(),
		workOrderIds: z.array(workOrderId).max(500)
	}),
	async (data) => {
		await guardProject(data.projectId);
		await reorderTasks(data.projectId, data.sectionId, data.workOrderIds);
		await refresh(data.projectId);
	}
);

// ---------------------------------------------------------------------------
// Tasks and sections
// ---------------------------------------------------------------------------

/** A line typed into the list and Enter pressed: a title, nothing else. */
export const createTaskForm = form(
	z.object({
		projectId,
		title: z.string().min(1, 'Give it a title').max(VOLUNTEER_SHIFT_TITLE_MAX),
		sectionId: optionalId
	}),
	async (data) => {
		const { user } = await guardProject(data.projectId);
		const row = await createTask({
			projectId: data.projectId,
			title: data.title,
			sectionId: data.sectionId || null,
			createdByUserId: user.id
		});
		await refresh(data.projectId);
		return { id: row.id };
	}
);

export const createSectionForm = form(
	z.object({ projectId, name: z.string().min(1, 'Give it a name').max(80) }),
	async (data) => {
		await guardProject(data.projectId);
		const row = await createSection(data.projectId, data.name);
		await refresh(data.projectId);
		return { id: row.id };
	}
);

export const renameSectionForm = form(
	z.object({ projectId, sectionId, name: z.string().min(1, 'Give it a name').max(80) }),
	async (data) => {
		await guardProject(data.projectId);
		await renameSection(data.projectId, data.sectionId, data.name);
		await refresh(data.projectId);
		return { success: true };
	}
);

/** Its tasks move to the unlabelled group; none is deleted. */
export const deleteSectionForm = form(z.object({ projectId, sectionId }), async (data) => {
	await guardProject(data.projectId);
	const moved = await deleteSection(data.projectId, data.sectionId);
	await refresh(data.projectId);
	return { moved };
});

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/** Members mode: name people. Raises the places if they outnumber them. */
export const assignMembersForm = form(
	z.object({
		projectId,
		workOrderId,
		userIds: z.array(z.string().min(1)).max(50).default([]),
		volunteerRoleId: optionalId
	}),
	async (data) => {
		await guardTask(data.projectId, data.workOrderId);
		const result = await assignMembers(data.projectId, data.workOrderId, {
			userIds: data.userIds,
			volunteerRoleId: data.volunteerRoleId || null
		});
		await refresh(data.projectId);
		return result;
	}
);

export const unassignMemberForm = form(
	z.object({ projectId, workOrderId, userId: z.string().min(1) }),
	async (data) => {
		await guardTask(data.projectId, data.workOrderId);
		await unassignMember(data.projectId, data.workOrderId, data.userId);
		await refresh(data.projectId);
		return { success: true };
	}
);

/** Open mode: post it to the claim board with a role and a number of places. */
export const openTaskForm = form(
	z.object({
		projectId,
		workOrderId,
		volunteerRoleId: optionalId,
		capacity: z.number().int().min(1).optional()
	}),
	async (data) => {
		const { user } = await guardTask(data.projectId, data.workOrderId);
		const mode = await openToVolunteers(data.projectId, data.workOrderId, {
			volunteerRoleId: data.volunteerRoleId || null,
			capacity: data.capacity,
			postedByUserId: user.id
		});
		await refresh(data.projectId);
		return { mode };
	}
);

/**
 * Contractor mode: an engagement on the task. With people on it the first
 * submit only reports how many; resubmitting with `confirm` takes them off.
 */
export const engageContractorForm = form(
	z.object({
		projectId,
		workOrderId,
		contractorId: z.string().min(1, 'Pick a contractor'),
		quotedCents: z.number().int().min(0).optional(),
		confirm: z.boolean().optional()
	}),
	async (data) => {
		const { user } = await guardTask(data.projectId, data.workOrderId);
		const result = await engageContractor(data.projectId, data.workOrderId, {
			contractorId: data.contractorId,
			quotedCents: data.quotedCents ?? null,
			requestedByUserId: user.id,
			confirm: data.confirm === true
		});
		if (result.status === 'done') await refresh(data.projectId);
		return result;
	}
);

/**
 * Nobody answers it. With people on it the first submit only reports how
 * many; resubmitting with `confirm` takes them off and tells them.
 */
export const unassignTaskForm = form(
	z.object({ projectId, workOrderId, confirm: z.boolean().optional() }),
	async (data) => {
		await guardTask(data.projectId, data.workOrderId);
		const result = await unassignTask(data.projectId, data.workOrderId, {
			confirm: data.confirm === true
		});
		if (result.status === 'done') await refresh(data.projectId);
		return result;
	}
);

// ---------------------------------------------------------------------------
// Done, reopened, rescheduled, called off
// ---------------------------------------------------------------------------

export const resolveTaskForm = form(
	z.object({ projectId, workOrderId, reason: z.string().max(2000).optional() }),
	async (data) => {
		const { user } = await guardTask(data.projectId, data.workOrderId);
		await resolveTask(data.projectId, data.workOrderId, {
			resolvedByUserId: user.id,
			reason: data.reason
		});
		await refresh(data.projectId);
		return { success: true };
	}
);

export const reopenTaskForm = form(z.object({ projectId, workOrderId }), async (data) => {
	await guardTask(data.projectId, data.workOrderId);
	await reopenTask(data.projectId, data.workOrderId);
	await refresh(data.projectId);
	return { success: true };
});

/** Window as `datetime-local` values (both or neither); due as a `date`. Blank clears. */
export const rescheduleTaskForm = form(
	z.object({
		projectId,
		workOrderId,
		startsAt: z.string().optional(),
		endsAt: z.string().optional(),
		dueAt: z.string().optional()
	}),
	async (data) => {
		await guardTask(data.projectId, data.workOrderId);
		await rescheduleTask(data.projectId, data.workOrderId, {
			startsAt: data.startsAt || null,
			endsAt: data.endsAt || null,
			dueAt: data.dueAt ? buildDateInTz(data.dueAt, '12:00', DEFAULT_TIMEZONE) : null
		});
		await refresh(data.projectId);
		return { success: true };
	}
);

export const cancelTaskForm = form(z.object({ projectId, workOrderId }), async (data) => {
	const { user } = await guardTask(data.projectId, data.workOrderId);
	await cancelTask(data.projectId, data.workOrderId, user.id);
	await refresh(data.projectId);
	return { success: true };
});

// ---------------------------------------------------------------------------
// Duties and equipment
// ---------------------------------------------------------------------------

export const addDutyForm = form(
	z.object({ projectId, workOrderId, label: z.string().min(1, 'Say what it is').max(200) }),
	async (data) => {
		await guardTask(data.projectId, data.workOrderId);
		const row = await addDuty(data.projectId, data.workOrderId, data.label);
		await refresh(data.projectId);
		return { id: row.id };
	}
);

export const setDutyDoneForm = form(
	z.object({
		projectId,
		workOrderId,
		dutyId: z.string().min(1),
		// An unticked box submits nothing, which reads as false.
		done: z.boolean().optional().default(false)
	}),
	async (data) => {
		const { user } = await guardTask(data.projectId, data.workOrderId);
		await setDutyDone(data.projectId, data.workOrderId, data.dutyId, data.done, user.id);
		await refresh(data.projectId);
		return { success: true };
	}
);

/** The unit the task is about; blank takes it off. */
export const setTaskEquipmentForm = form(
	z.object({ projectId, workOrderId, assetId: optionalId }),
	async (data) => {
		await guardTask(data.projectId, data.workOrderId);
		await setTaskEquipment(data.projectId, data.workOrderId, data.assetId || null);
		await refresh(data.projectId);
		return { success: true };
	}
);
