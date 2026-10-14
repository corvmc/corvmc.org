import { z } from 'zod';
import { query } from '$app/server';
import { command } from './_remote';
import { can, requireUser } from '$lib/server/authorization';
import { requireProjectCommittee } from '$lib/server/group/group-context';
import { mapDomainError } from '$lib/server/errors';
import { getProjectById } from '$lib/server/project/project-service';
import { getProjectDetail } from './projects.remote';
import { reorderSections } from '$lib/server/project/project-section-service';
import {
	listAssignableMembers,
	listProjectTasks,
	moveTask,
	reorderTasks,
	requireTaskInProject
} from '$lib/server/project/project-task-service';

/**
 * A project's task list: its work orders as a checklist, with sections.
 *
 * Every write is the project's committee (`project.manage` carries) or staff
 * holding it, as applying a duty list is. Both ids come from the client, so a
 * remote naming a work order loads it and 404s unless it is on that project.
 * The task forms land with the project page that submits them.
 */

const projectId = z.uuid();
const workOrderId = z.string().min(1);
const sectionId = z.string().min(1);

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

/** Who the assignment picker lists for one task. */
export const getTaskAssignees = query(
	z.object({ projectId, workOrderId }),
	async ({ projectId, workOrderId }) => {
		try {
			await guardTask(projectId, workOrderId);
			return await listAssignableMembers(projectId, workOrderId);
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
