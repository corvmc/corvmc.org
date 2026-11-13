import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability, requireUser } from '#lib/server/authorization.js';
import { requireProjectCommittee } from '#lib/server/group/group-context.js';
import { mapDomainError } from '#lib/server/errors.js';
import { invalid } from '@sveltejs/kit';
import { DEFAULT_TIMEZONE, VOLUNTEER_SHIFT_TITLE_MAX } from '#lib/config.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import {
	getProjectById,
	listCommittees,
	listProjects
} from '#lib/server/project/project-service.js';
import { listDutyLists } from '#lib/server/volunteer/duty-list-service.js';
import { getProjectActivity, getProjectDetail } from './projects.remote';
import { createTask, rescheduleTask } from '#lib/server/project/project-task-service.js';
import { listJobs } from '#lib/server/contractor/contractor-job-service.js';
import { listTaskCatalogue } from '#lib/server/volunteer/task-catalogue.js';
import { listOpenBlockers } from '#lib/server/volunteer/task-dependencies.js';
import {
	createWorkOrder,
	openShift,
	parseLocal,
	validateTimes
} from '#lib/server/volunteer/work-order-service.js';
import { listVolunteerRoles } from '#lib/server/volunteer/volunteer-role-service.js';
import {
	isRelatedTask,
	relatedEndedShifts,
	relatedShiftTasks,
	relatedShifts
} from '#lib/server/task/related-shifts.js';
import { shiftLabel } from '#lib/utils/shift-label.js';
import { requireListingReader } from '#lib/server/event/listing-guard.js';
import {
	aboutWhere,
	newTaskPrefill,
	relatedTasks,
	type RelatedSubject
} from '#lib/server/task/related-tasks.js';
import { relatedSubjectTypes } from '#lib/utils/related-tasks.js';

/**
 * The Tasks table (#2625) and the task it creates. A task's own writes are on
 * its page, through the shared work-order remotes in `volunteer.remote`.
 */

const projectId = z.uuid();
/** A cleared `select` posts `''`. */
const optionalId = z.union([z.literal(''), z.string().min(1)]).optional();

/** A project's write is its committee's (`project.manage` carries) or staff holding it. */
async function guardProject(id: string) {
	requireUser();
	try {
		await getProjectById(id);
	} catch (err) {
		mapDomainError(err);
	}
	return requireProjectCommittee(id, 'project.manage');
}

type TaskJob = Awaited<ReturnType<typeof listJobs>>[number];

/** Per task, who is engaged on it and whether that is late or awaiting an invoice. */
function contractorMarks(jobs: TaskJob[]) {
	const marks: Record<string, { name: string; late: boolean; awaitingInvoice: boolean }[]> = {};
	for (const j of jobs) {
		(marks[j.job.workOrderId] ??= []).push({
			name: j.contractor.name,
			late: j.late,
			awaitingInvoice: j.awaitingInvoice
		});
	}
	return marks;
}

const subject = z.object({ type: z.enum(relatedSubjectTypes), id: z.string().min(1) });

/**
 * The Tasks table (#2625): every task, in a project or none. Engagements are
 * read by view rather than by task id, which would bind one parameter per row.
 * Done work awaiting an invoice rides along so its chip can count it. With
 * `projectId`, it is that project's list, as the project's page shows it.
 */
export const getTasksPage = query(
	z.object({
		projectId: projectId.optional(),
		volunteerRoleId: z.string().optional(),
		includeDone: z.boolean().optional(),
		about: subject.optional()
	}),
	async (f) => {
		await requireCapability('project.read');
		const contractorAccess = await can('contractor.read');
		const jobs = contractorAccess
			? (
					await Promise.all([listJobs({ view: 'open' }), listJobs({ view: 'awaiting-invoice' })])
				).flat()
			: [];
		const [tasks, projects, committees, templates, waitsOn] = await Promise.all([
			listTaskCatalogue({
				projectId: f.projectId,
				volunteerRoleId: f.volunteerRoleId || undefined,
				includeDone: f.includeDone,
				withAwaitingInvoice: contractorAccess,
				...(f.about ? { where: aboutWhere(f.about) } : {})
			}),
			listProjects({ archived: false }),
			listCommittees(),
			listDutyLists(),
			listOpenBlockers()
		]);
		return {
			tasks,
			contractors: contractorMarks(jobs),
			contractorAccess,
			// What New task and New project offer.
			projects: projects.map((p) => ({ id: p.id, name: p.name })),
			committees: committees.map((c) => ({ id: c.id, name: c.name })),
			templates: templates
				.filter((t) => t.itemCount > 0 && !t.grantStage)
				.map((t) => ({ id: t.id, name: t.name })),
			// Per open task, the open tasks it waits on: Blocked, by name (#2625).
			waitsOn
		};
	}
);

/** The record's own read guard; a type with no relations still needs a session. */
async function requireSubjectReader(s: RelatedSubject) {
	switch (s.type) {
		case 'event':
			return requireListingReader(s.id);
		case 'project':
			return requireCapability('project.read');
		case 'group':
			return requireCapability('group.read');
		case 'role':
		case 'recurring_work':
			return requireCapability('volunteer.read');
		default:
			return requireUser();
	}
}

/**
 * `RelatedTasks` (#2630): the record's read guard first, then the Tasks
 * table's own (`project.read`), which sees every task. A reader of the record
 * without it gets null, so the card is left off rather than failing the page.
 */
export const getRelatedTasks = query(
	subject.extend({ includeDone: z.boolean().optional() }),
	async ({ includeDone, ...s }) => {
		await requireSubjectReader(s);
		if (!(await can('project.read'))) return null;
		const [groups, prefill, contractorAccess] = await Promise.all([
			relatedTasks(s, { includeDone }),
			newTaskPrefill(s),
			can('contractor.read')
		]);
		const workOrderIds = groups.flatMap((g) => g.tasks.map((t) => t.id));
		const jobs =
			contractorAccess && workOrderIds.length > 0
				? (
						await Promise.all([
							listJobs({ workOrderIds, view: 'open' }),
							listJobs({ workOrderIds, view: 'awaiting-invoice' })
						])
					).flat()
				: [];
		return { groups, contractors: contractorMarks(jobs), prefill };
	}
);

/**
 * `RelatedShifts` (#2630): the record's read guard first, then Volunteering's
 * own (`volunteer.read`); a reader of the record without it gets null. Add
 * shift's choices come only to a viewer who can open shifts.
 */
export const getRelatedShifts = query(subject, async (s) => {
	await requireSubjectReader(s);
	if (!(await can('volunteer.read'))) return null;
	const [groups, ended, canManage] = await Promise.all([
		relatedShifts(s),
		relatedEndedShifts(s),
		can('volunteer.manageShifts')
	]);
	const addShift = canManage ? await addShiftChoices(s) : null;
	return { groups, ended: ended.length, addShift };
});

async function addShiftChoices(s: RelatedSubject) {
	const [tasks, prefill, roles] = await Promise.all([
		relatedShiftTasks(s),
		newTaskPrefill(s),
		listVolunteerRoles()
	]);
	// Each choice carries its role's shift defaults, which the form starts from.
	const defaults = (r: {
		defaultCapacity: number | null;
		defaultDurationMinutes: number | null;
	}) => ({
		capacity: r.defaultCapacity,
		minutes: r.defaultDurationMinutes
	});
	return {
		tasks: tasks.map((t) => ({ id: t.id, label: shiftLabel(t), ...defaults(t) })),
		/** A new task takes the record's anchors; null where the record makes none. */
		newTask: prefill === null ? null : { roleId: prefill.volunteerRoleId ?? null },
		roles: roles.map((r) => ({ id: r.id, name: r.name, ...defaults(r) }))
	};
}

/**
 * Add shift from a record's card: on one of its tasks, or on a new task that
 * takes the record's anchors. The times are checked before the task is made,
 * so a refused shift leaves no empty task behind.
 */
export const addRelatedShift = form(
	z.object({
		subjectType: z.enum(relatedSubjectTypes),
		subjectId: z.string().min(1),
		taskId: optionalId,
		volunteerRoleId: optionalId,
		title: z.string().trim().max(VOLUNTEER_SHIFT_TITLE_MAX).optional(),
		startsAt: z.string().min(1, 'Pick when it starts'),
		endsAt: z.string().min(1, 'Pick when it ends'),
		capacity: z.string().optional()
	}),
	async (data, issue) => {
		const staff = await requireCapability('volunteer.manageShifts');
		const s = { type: data.subjectType, id: data.subjectId };
		await requireSubjectReader(s);
		validateTimes(parseLocal(data.startsAt, 'Start'), parseLocal(data.endsAt, 'End'));

		let taskId = data.taskId || '';
		if (taskId) {
			if (!(await isRelatedTask(s, taskId))) invalid(issue.taskId('Pick one of these tasks'));
		} else {
			const prefill = await newTaskPrefill(s);
			if (!prefill) invalid(issue.taskId('Pick a task'));
			const roleId = prefill.volunteerRoleId ?? (data.volunteerRoleId || '');
			if (!roleId) invalid(issue.volunteerRoleId('Pick a role'));
			const task = await createWorkOrder({
				...prefill,
				volunteerRoleId: roleId,
				title: data.title || null,
				createdByUserId: staff.id
			});
			taskId = task.id;
		}
		await openShift(taskId, {
			startsAt: data.startsAt,
			endsAt: data.endsAt,
			capacity: data.capacity ? parseInt(data.capacity, 10) : undefined,
			createdByUserId: staff.id
		});
		void getRelatedShifts(s).refresh();
		return { id: taskId };
	}
);

/** The project page reads through its one query; a committee member cannot run it. */
async function refresh(id: string) {
	if (!(await can('project.read'))) return;
	void getProjectDetail(id).refresh();
	void getProjectActivity({ projectId: id }).refresh();
}

/**
 * New task from the Tasks table, in a project or none. In a project it is the
 * project's to write; in none, it is the coordinator's, as a new work order is.
 */
export const createCatalogueTaskForm = form(
	z.object({
		title: z.string().trim().min(1, 'Give it a title').max(VOLUNTEER_SHIFT_TITLE_MAX),
		projectId: z.union([z.literal(''), projectId]).optional(),
		dueAt: z.string().optional(),
		// What `RelatedTasks` fills in from the record it sits on (#2630).
		eventId: optionalId,
		groupId: optionalId,
		volunteerRoleId: optionalId
	}),
	async (data) => {
		const dueAt = data.dueAt ? buildDateInTz(data.dueAt, '12:00', DEFAULT_TIMEZONE) : null;
		const anchors = {
			eventId: data.eventId || null,
			groupId: data.groupId || null,
			volunteerRoleId: data.volunteerRoleId || null
		};
		if (data.projectId) {
			const { user } = await guardProject(data.projectId);
			const row = await createTask({
				projectId: data.projectId,
				title: data.title,
				createdByUserId: user.id,
				...anchors
			});
			if (dueAt) await rescheduleTask(data.projectId, row.id, { dueAt });
			await refresh(data.projectId);
			return { id: row.id };
		}
		const staff = await requireCapability('volunteer.manageShifts');
		const row = await createWorkOrder({
			title: data.title,
			dueAt,
			createdByUserId: staff.id,
			...anchors
		});
		return { id: row.id };
	}
);
