import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Every tab on /staff/settings renders.
 *
 * The page mounts inside the staff layout's `ErrorToastBoundary`, so a throw in
 * one tab's markup does not degrade that tab — it replaces the whole page with
 * "Failed to load", tab bar included. That is how the Inbox Channels tab could
 * be broken for months without looking like a broken tab: `channelMeta` was
 * typed `Record<string, …>` and had no `direct` entry, `getAllChannelConfigs`
 * handed it every channel in the vocabulary, and reading `.icon` off undefined
 * blanked Settings.
 *
 * Nothing else clicks these four, and the per-tab assertion is deliberately
 * thin: the point is that each panel renders at all.
 */

const TABS = ['organization', 'inbox', 'features', 'subscriptions'];

const panel = (page: Page, key: string) =>
	page.locator(`[role="tabpanel"][aria-labelledby="tab-${key}"]`);

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('staff settings tabs', () => {
	test('renders every tab without tripping the error boundary, channels included', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/settings');

		// The boundary swallows the tab bar too, so this is also the check that the
		// page rendered at all before the first click.
		await expect(page.locator('#tab-organization')).toBeVisible({ timeout: 15000 });

		for (const key of TABS) {
			await page.locator(`#tab-${key}`).click();
			await expect(panel(page, key).locator(':scope > *').first()).toBeVisible();
			await expect(page.locator('[data-boundary-failed]')).toHaveCount(0);
		}

		// Inbox Channels lists the staff-administered channels and not member DMs.
		await page.locator('#tab-inbox').click();

		for (const channel of ['email', 'sms', 'web', 'portal', 'instagram', 'messenger'])
			await expect(panel(page, 'inbox').getByTestId(`channel-${channel}`)).toBeVisible();

		// `direct` is member↔member: staff never reply on it and there is nothing
		// behind it to enable, so it is not one of this tab's rows.
		await expect(panel(page, 'inbox').getByTestId('channel-direct')).toHaveCount(0);
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
