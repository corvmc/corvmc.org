import { expect, test } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import { SEED_APPLICANT_EMAIL, SEED_APPLICANT_PASSWORD } from './fixtures/seed-instructors';

/**
 * The member Reserve space modal reaches a priced confirm step (#2571): kit
 * names each field `<key>/<form id>`, and a read by bare key priced nothing.
 * It stops at the confirm step. The band and teaching specs cover booking, and
 * a write here would race them for the first free slot.
 */
test('the member Reserve space modal prices the chosen slot', async ({ page }) => {
	await signInAs(page, { email: SEED_APPLICANT_EMAIL, password: SEED_APPLICANT_PASSWORD });
	await page.goto('/member/reservations');

	await page.getByTestId('book-space').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible({ timeout: 15000 });

	const startTime = dialog.locator('select:is([name="startTime"], [name^="startTime/"])');
	await expect(startTime).toBeEnabled({ timeout: 15000 });
	const firstFree = await startTime
		.locator('option:not([disabled]):not([value=""])')
		.first()
		.getAttribute('value');
	await startTime.selectOption(firstFree ?? '');

	const endTime = dialog.locator('select:is([name="endTime"], [name^="endTime/"])');
	await expect(endTime).toBeEnabled({ timeout: 15000 });
	await endTime.selectOption({ index: 1 });

	const phone = dialog.locator('input:is([name="phone"], [name^="phone/"])');
	if (await phone.count()) await phone.fill('541-555-0177');

	const advance = dialog.locator('[data-step="0"] button[data-status]');
	await expect(advance).toBeEnabled({ timeout: 15000 });
	await advance.click();

	const confirm = dialog.locator('[data-step="1"]');
	await expect(confirm.getByTestId('confirm-slot')).toBeVisible({ timeout: 15000 });
	await expect(confirm.getByTestId('confirm-pricing')).toBeVisible({ timeout: 15000 });
	await expect(confirm.getByTestId('confirm-pricing-error')).toHaveCount(0);
});
