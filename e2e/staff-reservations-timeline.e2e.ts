import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { expectSuccessToast } from './toast';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Closures and recurring series folded into Reservations (#1833, #1936): the
 * old pages redirect, and a closure made from the header shows up as a row.
 */

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('reservations timeline', () => {
	test('a closure made from the header is a row of the list', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/closures');
		await page.waitForURL(/\/staff\/reservations\?show=closures/, { timeout: 15000 });

		// Far enough out that it blocks no slot another spec books.
		const reason = `E2E closure ${Date.now()}`;
		const start = { entered: '09:00', shown: '9:00' };
		await page.getByTestId('new-closure').click();
		const dialog = page.getByRole('dialog').filter({ has: page.locator('input[name="reason"]') });
		await dialog.locator('input[name="reason"]').fill(reason);
		await dialog.locator('input[name="startsAt"]').fill(`2099-01-05T${start.entered}`);
		await dialog.locator('input[name="endsAt"]').fill('2099-01-05T17:00');
		await dialog.locator('button[type="submit"]').click();
		await expectSuccessToast(page);

		await page.getByRole('searchbox').fill(reason);
		const row = page.getByRole('row').filter({ hasText: reason });
		// A closure row, not a booking: the error badge is the closure's marker.
		await expect(row.locator('.badge-error')).toBeVisible();
		await expect(row).toContainText(start.shown);
	});

	test('the old recurring address opens the series modal', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/recurring');
		await page.waitForURL(/\/staff\/reservations\?recurring/, { timeout: 15000 });
		// The only modal `?recurring` opens.
		await expect(page.getByRole('dialog')).toBeVisible();
	});
});
