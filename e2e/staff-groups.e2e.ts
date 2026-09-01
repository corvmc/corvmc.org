import { expect, test, type Page } from '@playwright/test';
import {
	SEED_STAFF_EMAIL,
	SEED_STAFF_PASSWORD,
	SEED_TARGET_NAME
} from './fixtures/seed-staff-user';
import { SEED_CLUB_NAME, SEED_COMMITTEE_ID, SEED_COMMITTEE_NAME } from './fixtures/seed-groups';
import { SEED_PUBLIC_BAND_NAME } from './fixtures/seed-band-onboarding';

/**
 * `/staff/groups` — the only place a club or committee comes into existence.
 *
 * Three things here are worth a browser rather than a unit test, because all
 * three are about what a page renders rather than what a service writes:
 *
 *  - the list is clubs and committees and never bands, which is the whole point
 *    of the `kind` filter every group read now carries;
 *  - creating one appoints its leader in the same step, with no invitation for
 *    them to accept;
 *  - an application renders apart from the member list. A `by_application`
 *    group's requests mixed into the roster is precisely the fail-quiet that
 *    the separate `'requested'` status exists to prevent, and it is invisible in
 *    a diff.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('staff groups', () => {
	test('lists clubs and committees, and never a band', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/groups');

		const table = page.locator('table');
		// `goto` resolves before an awaited remote query commits, so wait for a row
		// rather than asserting on an empty <main>.
		await expect(table.getByText(SEED_CLUB_NAME)).toBeVisible();
		await expect(table.getByText(SEED_COMMITTEE_NAME)).toBeVisible();

		// A band the band fixtures seed. If the kind filter were missing, every
		// band in the database would be on this page.
		await expect(table.getByText(SEED_PUBLIC_BAND_NAME)).toHaveCount(0);
	});

	test('the Groups row is in the staff sidebar, beside Bands', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/groups');

		const nav = page.locator('aside ul.menu').first();
		await expect(nav.getByRole('link', { name: 'Groups' })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Bands' })).toBeVisible();
	});

	test('creates a club and appoints its leader in one step', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/groups');

		await page.getByRole('button', { name: 'New group' }).click();

		const name = `E2E Songwriter Circle ${Date.now()}`;
		await page.locator('input[name="name"]').fill(name);

		// The leader picker is a typeahead over every member, not a select.
		// `pressSequentially`, not `fill`: bits-ui's Combobox opens on real key
		// events, and a programmatic value set leaves it closed with its results
		// list unrendered.
		const picker = page.locator('input[role="combobox"]');
		await picker.click();
		await picker.pressSequentially(SEED_TARGET_NAME.slice(0, 12));
		await page
			.getByRole('option', { name: new RegExp(SEED_TARGET_NAME, 'i') })
			.first()
			.click({ timeout: 15000 });
		// SearchSelect swaps the input for a badge once the pick commits; waiting
		// for that is how the test knows the choice reached the form.
		await expect(picker).toHaveCount(0);

		await page.getByRole('button', { name: 'Create group' }).click();

		// Straight to the new group's page, which is what carries the proof: the
		// appointee is the owner already, with nothing to accept.
		await page.waitForURL(/\/staff\/groups\/[0-9a-f-]{36}/, { timeout: 15000 });
		await expect(page.getByRole('heading', { name })).toBeVisible();
		await expect(page.getByText(SEED_TARGET_NAME).first()).toBeVisible();
	});

	test('shows an application apart from the member list', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/groups');
		await page.locator('table').getByText(SEED_COMMITTEE_NAME).click();

		// The fixture's own id, not a uuid — it is seeded rather than created.
		await page.waitForURL(`**/staff/groups/${SEED_COMMITTEE_ID}`, { timeout: 15000 });

		// The seeded committee is `by_application` and carries one requested row.
		await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();

		// By name, not `getByLabel`: `FormField` renders its label as a `<legend>`
		// inside a `<fieldset>`, which names the group rather than the control, so
		// no FormField input in this app is reachable by its label text.
		await expect(page.locator('select[name="joinPolicy"]')).toHaveValue('by_application');
	});
});
