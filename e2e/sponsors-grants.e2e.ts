import { test, expect, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_SPONSOR_ID,
	SEED_SPONSOR_NAME,
	SEED_GRANT_OVERDUE_TITLE,
	SEED_GRANT_PROSPECT_TITLE,
	SEED_GRANT_SUBMIT_ID
} from './fixtures/seed-sponsors-grants';
import { expectSuccessToast } from './toast';

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('sponsors', () => {
	test('a lapsed term is called out on the sponsor', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/sponsors/${SEED_SPONSOR_ID}`);
		await expect(page.getByRole('heading', { name: SEED_SPONSOR_NAME })).toBeVisible({
			timeout: 15000
		});
		await expect(page.getByRole('alert').filter({ hasText: 'Renew it' })).toBeVisible();
	});

	test('a new sponsor is created from the list', async ({ page }) => {
		const name = `E2E Bakery ${Date.now()}`;
		await loginAsStaff(page);
		await page.goto('/staff/sponsors');
		await page.getByRole('button', { name: 'New sponsor' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await dialog.locator('input[name="name"]').fill(name);
		await dialog.getByRole('button', { name: 'Add sponsor' }).click();
		await expectSuccessToast(page);
		await expect(page.locator('tbody tr').filter({ hasText: name })).toBeVisible();
	});
});

test.describe('grants', () => {
	test('the overdue report sorts ahead of a later application deadline', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/grants');
		const rows = page.locator('tbody tr');
		const overdue = rows.filter({ hasText: SEED_GRANT_OVERDUE_TITLE });
		await expect(overdue).toBeVisible({ timeout: 15000 });
		await expect(overdue).toContainText('Report due');

		const titles = await rows.allTextContents();
		const at = (t: string) => titles.findIndex((row) => row.includes(t));
		expect(at(SEED_GRANT_OVERDUE_TITLE)).toBeLessThan(at(SEED_GRANT_PROSPECT_TITLE));
	});

	test('submitting the report clears the overdue warning', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/grants/${SEED_GRANT_SUBMIT_ID}`);
		await expect(page.getByRole('alert').filter({ hasText: 'has passed' })).toBeVisible({
			timeout: 15000
		});

		const row = page.locator('tbody tr').filter({ hasText: 'Interim report' });
		await row.getByRole('button', { name: 'Edit' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.locator('input[name="submittedOn"]').fill('2026-01-01');
		await dialog.getByRole('button', { name: 'Save' }).click();
		await expectSuccessToast(page);
		await expect(page.getByRole('alert').filter({ hasText: 'has passed' })).toHaveCount(0);
	});
});
