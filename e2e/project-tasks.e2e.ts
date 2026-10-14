import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_TASK_DONE,
	SEED_TASK_EMPTY_SECTION,
	SEED_TASK_PROJECT_ID,
	SEED_TASK_PROJECT_NAME,
	SEED_TASK_UNASSIGNED,
	SEED_TASK_WITH_DUTIES
} from './fixtures/seed-project-tasks';

/**
 * A project's task list: sections, filters that live in the URL, duties that
 * unfold, a panel with its own URL, and adding and ticking in place. Only the
 * last test writes, and to a title of its own, so a retry finds nothing it left.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

const projectUrl = `/staff/projects/${SEED_TASK_PROJECT_ID}`;

test.describe('project task list', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(projectUrl);
		await expect(
			page.getByRole('heading', { level: 1, name: SEED_TASK_PROJECT_NAME })
		).toBeVisible();
		await expect(page.getByRole('link', { name: SEED_TASK_UNASSIGNED })).toBeVisible();
	});

	test('draws every section, the empty one included, and unfolds duties', async ({ page }) => {
		await expect(page.getByText(SEED_TASK_EMPTY_SECTION, { exact: true })).toBeVisible();
		await expect(page.getByText('No tasks yet.')).toBeVisible();

		await page
			.getByRole('button', { name: `Unfold the duties of ${SEED_TASK_WITH_DUTIES}` })
			.click();
		await expect(page.getByText('Stretch the new set')).toBeVisible();
	});

	test('filters live in the URL', async ({ page }) => {
		// Every seeded task is unassigned, so Contractors is the filter that hides them all.
		await page.getByRole('tab', { name: 'Contractors' }).click();
		await expect(page).toHaveURL(/show=contractors/);
		await expect(page.getByRole('link', { name: SEED_TASK_UNASSIGNED })).toBeHidden();
		await expect(page.getByText('Nothing here matches the filter.')).toBeVisible();

		await page.getByRole('tab', { name: 'Unassigned' }).click();
		await expect(page).toHaveURL(/show=unassigned/);
		await expect(page.getByRole('link', { name: SEED_TASK_WITH_DUTIES })).toBeVisible();

		await page.getByRole('tab', { name: 'All' }).click();
		await expect(page.getByRole('link', { name: SEED_TASK_DONE })).toBeVisible();
		await page.getByRole('button', { name: 'Hide done' }).click();
		await expect(page).toHaveURL(/done=hide/);
		await expect(page.getByRole('link', { name: SEED_TASK_DONE })).toBeHidden();
	});

	test('a row opens its panel at its own URL, and Escape closes it', async ({ page }) => {
		await page.getByRole('link', { name: SEED_TASK_UNASSIGNED }).click();
		await expect(page).toHaveURL(/[?&]task=/);
		const panel = page.getByRole('complementary', { name: SEED_TASK_UNASSIGNED });
		await expect(panel).toBeVisible();
		await expect(panel.getByText('Unassigned')).toBeVisible();
		await expect(panel.getByRole('link', { name: 'Details' })).toBeVisible();

		await page.reload();
		await expect(page.getByRole('complementary', { name: SEED_TASK_UNASSIGNED })).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page).not.toHaveURL(/[?&]task=/);
		await expect(page.getByRole('complementary', { name: SEED_TASK_UNASSIGNED })).toBeHidden();
	});

	test('a typed line becomes a task, and its checkbox ticks and unticks it', async ({ page }) => {
		const title = `E2E fetch the ladder ${Date.now()}`;
		const line = page.getByRole('textbox', { name: 'Add a task to Prep' });
		await line.fill(title);
		await line.press('Enter');
		await expect(page.getByRole('link', { name: title })).toBeVisible();
		await expect(line).toHaveValue('');

		await page.getByRole('button', { name: `Mark ${title} done` }).click();
		await expect(page.getByRole('button', { name: `Mark ${title} not done` })).toBeVisible();
		await page.getByRole('button', { name: `Mark ${title} not done` }).click();
		await expect(page.getByRole('button', { name: `Mark ${title} done` })).toBeVisible();
	});
});
