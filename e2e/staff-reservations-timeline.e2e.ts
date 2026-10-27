import { expect, test, type Page } from '@playwright/test';
import { expectSuccessToast } from './toast';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Closures and recurring series folded into Reservations (#1833, #1936): the
 * old pages redirect, and a closure made from the header shows up as a row.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('reservations timeline', () => {
	test('a closure made from the header is a row of the list', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/closures');
		await page.waitForURL(/\/staff\/reservations\?show=closures/, { timeout: 15000 });

		// Far enough out that it blocks no slot another spec books.
		const reason = `E2E closure ${Date.now()}`;
		await page.getByRole('button', { name: 'New Closure' }).click();
		const dialog = page.getByRole('dialog', { name: 'New Closure' });
		await dialog.locator('input[name="reason"]').fill(reason);
		await dialog.locator('input[name="startsAt"]').fill('2099-01-05T09:00');
		await dialog.locator('input[name="endsAt"]').fill('2099-01-05T17:00');
		await dialog.getByRole('button', { name: 'Add Closure' }).click();
		await expectSuccessToast(page);

		await page.getByRole('searchbox').fill(reason);
		const row = page.getByRole('row').filter({ hasText: reason });
		await expect(row).toContainText('Closed');
		await expect(row).toContainText('9:00');
	});

	test('the old recurring address opens the series modal', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/recurring');
		await page.waitForURL(/\/staff\/reservations\?recurring/, { timeout: 15000 });
		await expect(page.getByRole('dialog', { name: 'Recurring series' })).toBeVisible();
	});
});
