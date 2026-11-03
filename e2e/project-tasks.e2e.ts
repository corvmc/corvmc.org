import { eq } from 'drizzle-orm';
import { expect, test } from './fixtures/auth';
import { readLocalDb } from './fixtures/platform-db';
import { auditLog } from '../src/lib/server/db/schema/audit';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_TASK_DONE,
	SEED_TASK_DUTY,
	SEED_TASK_EMPTY_SECTION,
	SEED_TASK_PROJECT_ID,
	SEED_TASK_PROJECT_NAME,
	SEED_TASK_SECTION,
	SEED_TASK_UNASSIGNED,
	SEED_TASK_WITH_DUTIES
} from './fixtures/seed-project-tasks';

/**
 * A project's task list: sections, filters that live in the URL, duties that
 * unfold, a panel with its own URL, and adding and ticking in place. Only the
 * last test writes, and to a title of its own, so a retry finds nothing it left.
 */

test.use({ persona: { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD } });

const projectUrl = `/staff/projects/${SEED_TASK_PROJECT_ID}`;
const taskPages = `a[href^="/staff/projects/${SEED_TASK_PROJECT_ID}/tasks/"]`;
// Check quickly once, then back off: `readLocalDb` shares the preview's file.
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

test.describe('project task list', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(projectUrl);
		await expect(
			page.getByRole('heading', { level: 1, name: SEED_TASK_PROJECT_NAME })
		).toBeVisible();
		await expect(
			page.getByRole('table').getByRole('link', { name: SEED_TASK_UNASSIGNED, exact: true })
		).toBeVisible();
	});

	test('draws every section, the empty one included, and unfolds duties', async ({ page }) => {
		await expect(page.getByText(SEED_TASK_EMPTY_SECTION, { exact: true })).toBeVisible();
		// Under the empty section's heading: a note row, then the add line — no task.
		const empty = page.locator('tr.section-row').filter({ hasText: SEED_TASK_EMPTY_SECTION });
		const note = empty.locator('xpath=following-sibling::tr[1]');
		await expect(note).not.toBeEmpty();
		await expect(note.getByRole('link')).toHaveCount(0);
		await expect(note.getByRole('textbox')).toHaveCount(0);
		await expect(note.locator('xpath=following-sibling::tr[1]').getByRole('textbox')).toBeVisible();

		await page
			.getByRole('button', { name: `Unfold the duties of ${SEED_TASK_WITH_DUTIES}` })
			.click();
		await expect(page.getByText(SEED_TASK_DUTY)).toBeVisible();
	});

	test('filters live in the URL', async ({ page }) => {
		// The filter is a disclosure whose trigger names the active filter; "All" reads as "Filter".
		const menu = page.locator('details', {
			has: page.locator('summary', { hasText: /^\s*Filter/ })
		});
		const pick = async (from: string, to: string) => {
			const trigger = menu.locator('summary');
			await expect(trigger).toHaveText(from === 'All' ? 'Filter' : `Filter: ${from}`);
			await trigger.click();
			await menu.getByRole('button', { name: to, exact: true }).click();
		};
		// Every seeded task is unassigned, so Contractors is the filter that hides them all.
		await pick('All', 'Contractors');
		await expect(page).toHaveURL(/show=contractors/);
		await expect(
			page.getByRole('table').getByRole('link', { name: SEED_TASK_UNASSIGNED, exact: true })
		).toBeHidden();
		await expect(page.getByRole('table').locator('a[href*="task="]')).toHaveCount(0);

		await pick('Contractors', 'Unassigned');
		await expect(page).toHaveURL(/show=unassigned/);
		await expect(
			page.getByRole('table').getByRole('link', { name: SEED_TASK_WITH_DUTIES, exact: true })
		).toBeVisible();

		await pick('Unassigned', 'All');
		await expect(
			page.getByRole('table').getByRole('link', { name: SEED_TASK_DONE, exact: true })
		).toBeVisible();
		// The done toggle sits beside the filter menu, pressed while done is hidden.
		const hideDone = page.locator('details + button[aria-pressed]');
		await expect(hideDone).toHaveAttribute('aria-pressed', 'false');
		await hideDone.click();
		await expect(page).toHaveURL(/done=hide/);
		await expect(hideDone).toHaveAttribute('aria-pressed', 'true');
		await expect(
			page.getByRole('table').getByRole('link', { name: SEED_TASK_DONE, exact: true })
		).toBeHidden();
	});

	test('a row opens its panel at its own URL, and Escape closes it', async ({ page }) => {
		await page
			.getByRole('table')
			.getByRole('link', { name: SEED_TASK_UNASSIGNED, exact: true })
			.click();
		await expect(page).toHaveURL(/[?&]task=/);
		const panel = page.getByRole('complementary', { name: SEED_TASK_UNASSIGNED });
		await expect(panel).toBeVisible();
		await expect(panel.locator(taskPages)).toBeVisible();
		// Nobody on it: no stack of assignees.
		await expect(panel.locator('[data-assigned-stack]')).toHaveCount(0);

		await page.reload();
		await expect(page.getByRole('complementary', { name: SEED_TASK_UNASSIGNED })).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page).not.toHaveURL(/[?&]task=/);
		await expect(page.getByRole('complementary', { name: SEED_TASK_UNASSIGNED })).toBeHidden();
	});

	test('Details opens the task page, which the old shift URL redirects to', async ({ page }) => {
		await page
			.getByRole('table')
			.getByRole('link', { name: SEED_TASK_WITH_DUTIES, exact: true })
			.click();
		const panel = page.getByRole('complementary', { name: SEED_TASK_WITH_DUTIES });
		await panel.locator(taskPages).click();

		const taskUrl = new RegExp(`/staff/projects/${SEED_TASK_PROJECT_ID}/tasks/([^/?#]+)$`);
		await expect(page).toHaveURL(taskUrl);
		await expect(
			page.getByRole('heading', { level: 1, name: SEED_TASK_WITH_DUTIES })
		).toBeVisible();
		// Not the breadcrumb's copy of the same link: the line under the title.
		await expect(
			page.getByRole('paragraph').getByRole('link', { name: SEED_TASK_PROJECT_NAME })
		).toBeVisible();
		await expect(page.getByText(SEED_TASK_DUTY)).toBeVisible();

		const taskId = taskUrl.exec(page.url())![1];
		await page.goto(`/staff/volunteer/shifts/${taskId}`);
		await expect(page).toHaveURL(taskUrl);
		await expect(
			page.getByRole('heading', { level: 1, name: SEED_TASK_WITH_DUTIES })
		).toBeVisible();
	});

	test('a typed line becomes a task, and its checkbox ticks and unticks it', async ({ page }) => {
		const title = `E2E fetch the ladder ${Date.now()}`;
		const line = page.getByLabel(`Add a task to ${SEED_TASK_SECTION}`);
		await line.fill(title);
		await line.press('Enter');
		await expect(
			page.getByRole('table').getByRole('link', { name: title, exact: true })
		).toBeVisible();
		await expect(line).toHaveValue('');

		await page.getByRole('button', { name: `Mark ${title} done` }).click();
		await expect(page.getByRole('button', { name: `Mark ${title} not done` })).toBeVisible();
		await page.getByRole('button', { name: `Mark ${title} not done` }).click();
		await expect(page.getByRole('button', { name: `Mark ${title} done` })).toBeVisible();

		// What was recorded: the add, the tick and the untick, against this task.
		const href = await page
			.getByRole('table')
			.getByRole('link', { name: title, exact: true })
			.getAttribute('href');
		const taskId = new URLSearchParams(href?.split('?')[1]).get('task') ?? '';
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
			.toEqual(
				expect.arrayContaining(['work_order.created', 'work_order.resolved', 'work_order.reopened'])
			);

		// With no task open, the sidebar is the activity: newest first, linked to
		// the task. Only this test writes to the project, so the newest is ours.
		const activity = page.getByRole('main').getByRole('complementary');
		const ours = `a[href="/staff/projects/${SEED_TASK_PROJECT_ID}/tasks/${taskId}"]`;
		await expect(activity.getByRole('listitem').first().locator(ours)).toBeVisible();
		await expect(activity.locator(ours).first()).toBeVisible();
	});
});
