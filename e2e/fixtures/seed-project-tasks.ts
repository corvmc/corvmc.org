/**
 * A project with a task list, for `project-tasks.e2e.ts`: two sections (one
 * empty, which the list must still draw), an unassigned task with a due date,
 * a task with duties, and a done one.
 *
 * Run by `e2e/prepare.ts`. Idempotent: deletes its project's tasks, their
 * duties and its sections, then recreates them, so tasks a run added go too.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { project, projectSection } from '../../src/lib/server/db/schema/project';
import { workOrder, workTask } from '../../src/lib/server/db/schema/volunteer';
import { withPlatformDb } from './platform-db';

export const SEED_TASK_PROJECT_ID = 'e2e0b7a5-0000-4000-8000-000000000001';
export const SEED_TASK_PROJECT_NAME = 'E2E Back room refit';
export const SEED_TASK_SECTION = 'Prep';
export const SEED_TASK_EMPTY_SECTION = 'Wrap-up';
export const SEED_TASK_UNASSIGNED = 'E2E sweep the stage';
export const SEED_TASK_WITH_DUTIES = 'E2E restring the house guitar';
export const SEED_TASK_DONE = 'E2E order gaffer tape';

const SECTION_ID = 'e2e0b7a5-0000-4000-8000-000000000011';
const EMPTY_SECTION_ID = 'e2e0b7a5-0000-4000-8000-000000000012';
const DUTIES_TASK_ID = 'e2e0b7a5-0000-4000-8000-000000000022';

export async function seedProjectTasks() {
	await withPlatformDb(async (db) => {
		const old = await db
			.select({ id: workOrder.id })
			.from(workOrder)
			.where(eq(workOrder.projectId, SEED_TASK_PROJECT_ID));
		if (old.length > 0) {
			const ids = old.map((r) => r.id);
			await db.delete(workTask).where(inArray(workTask.workOrderId, ids));
			await db.delete(workOrder).where(inArray(workOrder.id, ids));
		}
		await db.delete(projectSection).where(eq(projectSection.projectId, SEED_TASK_PROJECT_ID));
		await db.delete(project).where(eq(project.id, SEED_TASK_PROJECT_ID));

		const now = new Date();
		await db.insert(project).values({
			id: SEED_TASK_PROJECT_ID,
			name: SEED_TASK_PROJECT_NAME,
			status: 'in_progress',
			description: 'Shelving, a new outlet strip, and the guitar wall.'
		});
		await db.insert(projectSection).values([
			{ id: SECTION_ID, projectId: SEED_TASK_PROJECT_ID, name: SEED_TASK_SECTION, sortOrder: 0 },
			{
				id: EMPTY_SECTION_ID,
				projectId: SEED_TASK_PROJECT_ID,
				name: SEED_TASK_EMPTY_SECTION,
				sortOrder: 1
			}
		]);
		await db.insert(workOrder).values([
			{
				title: SEED_TASK_UNASSIGNED,
				projectId: SEED_TASK_PROJECT_ID,
				sectionId: SECTION_ID,
				sortOrder: 0,
				dueAt: new Date(now.getTime() + 7 * 86_400_000)
			},
			{
				id: DUTIES_TASK_ID,
				title: SEED_TASK_WITH_DUTIES,
				projectId: SEED_TASK_PROJECT_ID,
				sectionId: SECTION_ID,
				sortOrder: 1
			},
			{
				title: SEED_TASK_DONE,
				projectId: SEED_TASK_PROJECT_ID,
				sectionId: SECTION_ID,
				sortOrder: 2,
				resolvedAt: now
			}
		]);
		await db.insert(workTask).values([
			{
				workOrderId: DUTIES_TASK_ID,
				label: 'Take the old strings off',
				sortOrder: 0,
				done: true,
				doneAt: now
			},
			{ workOrderId: DUTIES_TASK_ID, label: 'Stretch the new set', sortOrder: 1 }
		]);
	});
}
