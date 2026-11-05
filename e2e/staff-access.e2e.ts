import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import {
	SEED_STAFF_EMAIL,
	SEED_STAFF_NAME,
	SEED_STAFF_PASSWORD,
	SEED_TARGET_NAME
} from './fixtures/seed-staff-user';

/**
 * The access dashboard renders both views for an admin (#1942). Read-only on
 * purpose: the mutations are the existing remotes, covered where they live.
 */

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('staff access dashboard', () => {
	test('lists admins by position, and one person’s access by search', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/access');

		await expect(page).toHaveURL(/\/staff\/access$/);
		// The four summary figures: admins, staff, positions held, lapsing clearances.
		await expect(page.locator('main .stat')).toHaveCount(4);

		await page.locator('#tab-permission').click();
		await expect(page.getByRole('table').getByText(SEED_STAFF_NAME)).toBeVisible();

		await page.locator('#tab-person').click();
		// `pressSequentially`: bits-ui's Combobox opens on real key events only.
		const picker = page.locator('input[role="combobox"]');
		await picker.click();
		await picker.pressSequentially(SEED_TARGET_NAME);
		await page.getByRole('option', { name: new RegExp(SEED_TARGET_NAME) }).click();
		await expect(page.getByTestId('no-positions')).toBeVisible();
	});
});
