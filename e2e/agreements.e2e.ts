import { test, expect, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_AGREEMENT_GRANT_COUNTERPARTY,
	SEED_AGREEMENT_OVERDUE_COUNTERPARTY,
	SEED_AGREEMENT_OVERDUE_ID
} from './fixtures/seed-agreements';
import { expectSuccessToast } from './toast';

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('grants and sponsorships', () => {
	test('the overdue report sorts ahead of a later deadline', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/agreements');

		const rows = page.locator('tbody tr');
		const overdue = rows.filter({ hasText: SEED_AGREEMENT_OVERDUE_COUNTERPARTY });
		const grant = rows.filter({ hasText: SEED_AGREEMENT_GRANT_COUNTERPARTY });
		await expect(overdue).toBeVisible({ timeout: 15000 });
		await expect(grant).toBeVisible();

		const names = await rows.locator('td.cell-primary a').allTextContents();
		const at = (name: string) => names.findIndex((n) => n.includes(name));
		expect(at(SEED_AGREEMENT_OVERDUE_COUNTERPARTY)).toBeLessThan(
			at(SEED_AGREEMENT_GRANT_COUNTERPARTY)
		);
	});

	test('an overdue deadline is called out on the record', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/agreements/${SEED_AGREEMENT_OVERDUE_ID}`);

		await expect(
			page.getByRole('heading', { name: SEED_AGREEMENT_OVERDUE_COUNTERPARTY })
		).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole('alert')).toBeVisible();
	});

	test('a new grant is created from the list', async ({ page }) => {
		const name = `E2E Foundation ${Date.now()}`;
		await loginAsStaff(page);
		await page.goto('/staff/agreements');

		await page.getByRole('button', { name: 'New agreement' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });

		await dialog.locator('input[name="counterparty"]').fill(name);
		await dialog.locator('input[name="title"]').fill('Capital equipment');
		await dialog.locator('input[name="applyBy"]').fill('2099-01-15');
		await dialog.getByRole('button', { name: 'Add agreement' }).click();

		await expectSuccessToast(page);
		await expect(page.locator('tbody tr').filter({ hasText: name })).toBeVisible();
	});
});
