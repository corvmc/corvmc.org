import { expect, test, type Page } from '@playwright/test';
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
 * Nothing else clicks these seven, and the per-tab assertion is deliberately
 * thin: the point is that each panel renders at all.
 */

const tabPanels: [tab: string, marker: string | RegExp][] = [
	['Pricing', /Configure the products and pricing used for checkout/],
	['Reservations', /Configure operating hours, booking rules/],
	['Organization', /Organization identity used in emails/],
	['Integrations', /Manage credentials for third-party integrations/],
	['Inbox Channels', /Enable or disable communication channels for the staff inbox/],
	['Features', /Enable or disable feature modules/],
	['Subscriptions', /Reconciles every member and band subscription status from Stripe/]
];

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('staff settings tabs', () => {
	test('renders every tab without tripping the error boundary', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/settings');

		// The boundary swallows the tab bar too, so this is also the check that the
		// page rendered at all before the first click.
		await expect(page.getByRole('tab', { name: 'Pricing' })).toBeVisible({ timeout: 15000 });

		for (const [tab, marker] of tabPanels) {
			await page.getByRole('tab', { name: tab }).click();
			await expect(page.getByText(marker)).toBeVisible();
			await expect(page.getByText(/Failed to load/)).toHaveCount(0);
		}
	});

	test('lists the staff-administered channels and not member DMs', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/settings');
		await page.getByRole('tab', { name: 'Inbox Channels' }).click();

		for (const label of ['Email', 'SMS', 'Contact Form', 'Member Portal', 'Instagram', 'Messenger'])
			await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();

		// `direct` is member↔member: staff never reply on it and there is nothing
		// behind it to enable, so it is not one of this tab's rows.
		await expect(page.getByRole('heading', { name: 'Direct Message' })).toHaveCount(0);
	});
});
