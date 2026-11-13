import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability, requireUser } from '#lib/server/authorization.js';
import { requireProjectCommittee } from '#lib/server/group/group-context.js';
import { mapDomainError } from '#lib/server/errors.js';
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
import { createWorkOrder } from '#lib/server/volunteer/work-order-service.js';
import { requireListingReader } from '#lib/server/event/listing-guard.js';
import {
	newTaskPrefill,
	relatedTaskWhere,
	relatedTasks,
	type RelatedSubject
} from '#lib/server/task/related-tasks.js';
import { relatedSubjectTypes } from '#lib/utils/related-tasks.js';
import { sql } from 'drizzle-orm';

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

/** Nothing matches: `?about=` naming a type that resolves to no tasks. */
const NONE = sql`0 = 1`;

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
		const [tasks, projects, committees, templates] = await Promise.all([
			listTaskCatalogue({
				projectId: f.projectId,
				volunteerRoleId: f.volunteerRoleId || undefined,
				includeDone: f.includeDone,
				withAwaitingInvoice: contractorAccess,
				...(f.about ? { where: relatedTaskWhere(f.about) ?? NONE } : {})
			}),
			listProjects({ archived: false }),
			listCommittees(),
			listDutyLists()
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
				.map((t) => ({ id: t.id, name: t.name }))
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
