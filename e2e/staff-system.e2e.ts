import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * The System panel and the module settings that left Settings (#2763) render.
 *
 * Each page mounts inside the staff layout's `ErrorToastBoundary`, so a throw in
 * its markup replaces the whole page with "Failed to load". That is how Inbox
 * Channels was once broken for months: `channelMeta` had no `direct` entry and
 * reading `.icon` off undefined blanked the page. The assertions stay thin: the
 * point is that each page renders at all.
 */

const PAGES = [
	'/staff/system/organization',
	'/staff/system/features',
	'/staff/system/access',
	'/staff/system/audit',
	'/staff/inbox/channels',
	'/staff/volunteering/settings'
];

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('staff system panel', () => {
	test('renders every System row and module settings page', async ({ page }) => {
		await loginAsStaff(page);

		for (const path of PAGES) {
			await page.goto(path);
			await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15000 });
			await expect(page.locator('[data-boundary-failed]')).toHaveCount(0);
		}

		// The System panel has its own sidebar, with a way back to the staff one.
		await page.goto('/staff/system/organization');
		await expect(page.locator('aside a[href="/staff/system/audit"]')).toBeVisible();
		await expect(page.locator('aside a[href="/staff"]')).toBeVisible();

		// Inbox Channels lists the staff-administered channels and not member DMs.
		await page.goto('/staff/inbox/channels');
		for (const channel of ['email', 'sms', 'web', 'portal', 'instagram', 'messenger'])
			await expect(page.getByTestId(`channel-${channel}`)).toBeVisible();

		// `direct` is member↔member: staff never reply on it and there is nothing
		// behind it to enable, so it is not one of this page's rows.
		await expect(page.getByTestId('channel-direct')).toHaveCount(0);
	});

	test('the old Settings tabs land where they moved', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/settings?tab=inbox');
		await page.waitForURL(/\/staff\/inbox\/channels$/);
		await page.goto('/staff/settings');
		await page.waitForURL(/\/staff\/system\/organization$/);
	});

	test('the old Pricing and Reservations tabs land on Practice space settings', async ({
		page
	}) => {
		await loginAsStaff(page);
		for (const tab of ['pricing', 'reservations']) {
			await page.goto(`/staff/settings?tab=${tab}`);
			await page.waitForURL(/\/staff\/reservations\/settings$/);
			await expect(page.getByTestId('pricing-settings')).toBeVisible();
			await expect(page.getByTestId('space-settings')).toBeVisible();
			await expect(page.locator('[data-boundary-failed]')).toHaveCount(0);
		}
	});

	test('the old Integrations tab opens Building access, where the lock card moved', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/settings?tab=integrations');
		await page.waitForURL(/\/staff\/building-access$/);
		await expect(page.getByTestId('lock-status')).toBeVisible();
		await expect(page.getByTestId('active-codes')).toBeVisible();
		await expect(page.getByTestId('lock-settings')).toBeVisible();
		await expect(page.locator('[data-boundary-failed]')).toHaveCount(0);
	});
});
