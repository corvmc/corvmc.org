import { expect, test } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Pages that start a remote query on hydration died on every hard load with
 * "Cannot read properties of undefined (reading 'child')" until the kit patch
 * in `patches/` committed the render tree before mounting (#2414). Delete the
 * patch only when this passes without it.
 */
for (const path of ['/staff/reservations', '/staff/reports/volunteering']) {
	test(`${path} hydrates on a hard load`, async ({ page }) => {
		await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));

		await page.goto(path);
		await page.reload();
		await expect(page.locator('html[data-hydrated]')).toBeAttached();
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

		expect(errors).toEqual([]);
	});
}
