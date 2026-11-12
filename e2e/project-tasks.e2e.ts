import { eq } from 'drizzle-orm';
import { expect, test } from './fixtures/auth';
import { readLocalDb } from './fixtures/platform-db';
import { auditLog } from '../src/lib/server/db/schema/audit';
import { workOrder } from '../src/lib/server/db/schema/volunteer';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_TASK_DUTY,
	SEED_TASK_PROJECT_ID,
	SEED_TASK_PROJECT_NAME,
	SEED_TASK_UNASSIGNED,
	SEED_TASK_WITH_DUTIES
} from './fixtures/seed-project-tasks';

/**
 * A project's tasks are the Tasks table, filtered to it (#2625): rows open each
 * task's own page, old panel and shift addresses land there, and New task
 * makes one in this project. Only the last test writes, to a title of its own.
 */

test.use({ persona: { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD } });

const projectUrl = `/staff/tasks/projects/${SEED_TASK_PROJECT_ID}`;
const taskUrl = /\/staff\/tasks\/([^/?#]+)$/;
// Check quickly once, then back off: `readLocalDb` shares the preview's file.
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

test.describe('project tasks', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(projectUrl);
		await expect(
			page.getByRole('heading', { level: 1, name: SEED_TASK_PROJECT_NAME })
		).toBeVisible();
		await expect(
			page.getByRole('table').getByRole('link', { name: SEED_TASK_UNASSIGNED, exact: true })
		).toBeVisible();
	});

	test("lists only this project's tasks, without a project to group or filter by", async ({
		page
	}) => {
		const table = page.getByRole('table');
		// Every task link is a task page; none points at another project.
		const projectLinks = table.locator('a[href^="/staff/tasks/projects/"]');
		await expect(projectLinks).toHaveCount(0);
		await expect(page.locator('[data-testid="task-group"]')).toHaveCount(0);
		await expect(page.locator('[data-chip="unassigned"]')).toBeVisible();
	});

	test('a row opens its task page, which names the project and lists its duties', async ({
		page
	}) => {
		await page
			.getByRole('table')
			.getByRole('link', { name: SEED_TASK_WITH_DUTIES, exact: true })
			.click();
		await expect(page).toHaveURL(taskUrl);
		await expect(
			page.getByRole('heading', { level: 1, name: SEED_TASK_WITH_DUTIES })
		).toBeVisible();
		// Not the breadcrumb's copy of the same link: the line under the title.
		await expect(
			page.getByRole('paragraph').getByRole('link', { name: SEED_TASK_PROJECT_NAME })
		).toBeVisible();
		await expect(page.getByLabel(SEED_TASK_DUTY, { exact: true })).toBeVisible();

		// The old panel and shift addresses land on the same page.
		const taskId = taskUrl.exec(page.url())![1];
		await page.goto(`${projectUrl}?task=${taskId}`);
		await expect(page).toHaveURL(new RegExp(`/staff/tasks/${taskId}$`));
		await page.goto(`/staff/volunteer/shifts/${taskId}`);
		await expect(page).toHaveURL(new RegExp(`/staff/tasks/${taskId}$`));
	});

	test('New task makes a task in this project and opens its page', async ({ page }) => {
		const title = `E2E fetch the ladder ${Date.now()}`;
		await page.getByTestId('new-task').click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('input[name="title"]').fill(title);
		await dialog.locator('button[type="submit"]').click();

		await expect(page).toHaveURL(taskUrl);
		const taskId = taskUrl.exec(page.url())![1];
		await expect
			.poll(
				() =>
					readLocalDb((db) =>
						db
							.select({ projectId: workOrder.projectId })
							.from(workOrder)
							.where(eq(workOrder.id, taskId))
					),
				DB_POLL
			)
			.toEqual([{ projectId: SEED_TASK_PROJECT_ID }]);
		await expect
			.poll(
				() =>
					readLocalDb((db) =>
						db
							.select({ action: auditLog.action })
							.from(auditLog)
							.where(eq(auditLog.subjectId, taskId))
					).then((rows) => rows.map((r) => r.action)),
				DB_POLL
			)
			.toContain('work_order.created');

		// Back on the project, the new task is a row of its table.
		await page.goto(projectUrl);
		await expect(page.getByRole('table').locator(`a[href="/staff/tasks/${taskId}"]`)).toBeVisible();
	});
});
