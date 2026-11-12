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

/**
 * The Tasks table (#2625) and the task it creates. A task's own writes are on
 * its page, through the shared work-order remotes in `volunteer.remote`.
 */

const projectId = z.uuid();

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
		includeDone: z.boolean().optional()
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
				withAwaitingInvoice: contractorAccess
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
			templates: templates.filter((t) => t.itemCount > 0).map((t) => ({ id: t.id, name: t.name }))
		};
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
		dueAt: z.string().optional()
	}),
	async (data) => {
		const dueAt = data.dueAt ? buildDateInTz(data.dueAt, '12:00', DEFAULT_TIMEZONE) : null;
		if (data.projectId) {
			const { user } = await guardProject(data.projectId);
			const row = await createTask({
				projectId: data.projectId,
				title: data.title,
				createdByUserId: user.id
			});
			if (dueAt) await rescheduleTask(data.projectId, row.id, { dueAt });
			await refresh(data.projectId);
			return { id: row.id };
		}
		const staff = await requireCapability('volunteer.manageShifts');
		const row = await createWorkOrder({ title: data.title, dueAt, createdByUserId: staff.id });
		return { id: row.id };
	}
);
