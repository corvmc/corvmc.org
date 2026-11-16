import { test, expect, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_SPONSOR_ID, SEED_FUNDER_ID } from './fixtures/seed-sponsors-grants';
import { readLocalDb } from './fixtures/platform-db';
import { eq } from 'drizzle-orm';
import { grantApplication } from '../src/lib/server/db/schema/grant';
import { project } from '../src/lib/server/db/schema/project';
import { workOrder } from '../src/lib/server/db/schema/volunteer';
import { expectSuccessToast } from './toast';

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('sponsors', () => {
	test('a sponsorship added on the Funding page is listed there', async ({ page }) => {
		const title = `E2E season ${Date.now()}`;
		await loginAsStaff(page);
		await page.goto('/staff/funding');
		await page.getByTestId('new-sponsorship').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await dialog
			.locator('select:is([name="sponsorId"], [name^="sponsorId/"])')
			.selectOption(SEED_SPONSOR_ID);
		await dialog.locator('input:is([name="title"], [name^="title/"])').fill(title);
		await dialog.locator('button[type="submit"]').click();
		await expectSuccessToast(page);
		await expect(
			page.locator('tr[data-funding-kind="sponsorship"]').filter({ hasText: title })
		).toBeVisible();
	});
});

test.describe('grants', () => {
	test('a new grant opens its project with the application tasks', async ({ page }) => {
		const title = `E2E grant ${Date.now()}`;
		await loginAsStaff(page);
		await page.goto('/staff/funding');
		await page.getByTestId('new-grant').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await dialog
			.locator('select:is([name="funderId"], [name^="funderId/"])')
			.selectOption(SEED_FUNDER_ID);
		await dialog.locator('input:is([name="title"], [name^="title/"])').fill(title);
		await dialog.locator('input:is([name="applyBy"], [name^="applyBy/"])').fill('2030-03-01');
		await dialog.locator('button[type="submit"]').click();
		await expectSuccessToast(page);

		// The project is the grant's, and the template stamped its tasks, each dated.
		await expect
			.poll(() => grantWork(title), DB_POLL)
			.toEqual({ kind: 'grant', stamped: true, undated: 0 });
	});
});

const DB_POLL = { timeout: 15000 };

/** The new grant's project kind, whether it has tasks, and how many have no due date. */
async function grantWork(title: string) {
	const [row] = await readLocalDb((db) =>
		db
			.select({ projectId: grantApplication.projectId, kind: project.kind })
			.from(grantApplication)
			.innerJoin(project, eq(project.id, grantApplication.projectId))
			.where(eq(grantApplication.title, title))
	);
	if (!row?.projectId) return null;
	const tasks = await readLocalDb((db) =>
		db
			.select({ dueAt: workOrder.dueAt })
			.from(workOrder)
			.where(eq(workOrder.projectId, row.projectId!))
	);
	return {
		kind: row.kind,
		stamped: tasks.length > 0,
		undated: tasks.filter((t) => !t.dueAt).length
	};
}
