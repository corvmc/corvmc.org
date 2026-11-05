import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import {
	SEED_STAFF_EMAIL,
	SEED_STAFF_PASSWORD,
	SEED_TARGET_NAME
} from './fixtures/seed-staff-user';
import { SEED_CLUB_NAME, SEED_COMMITTEE_ID, SEED_COMMITTEE_NAME } from './fixtures/seed-groups';
import { SEED_PUBLIC_BAND_NAME } from './fixtures/seed-band-onboarding';

/**
 * The Clubs and Committees views of `/staff/groups/*` — the only places a club or
 * committee comes into existence.
 *
 * Three things here are worth a browser rather than a unit test, because all
 * three are about what a page renders rather than what a service writes:
 *
 *  - the list is clubs and committees and never bands, which is the whole point
 *    of the `kind` filter every group read now carries;
 *  - creating one appoints its first chair in the same step, with no invitation for
 *    them to accept;
 *  - an application renders on its own card, apart from the member list, for
 *    a viewer who may answer it. Mixed into the roster it would be a fail-quiet
 *    that is invisible in a diff.
 */

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('staff groups', () => {
	test('lists clubs, and never a committee or a band', async ({ page }) => {
		await loginAsStaff(page);
		// The old address, which is also the proof that it still lands somewhere.
		await page.goto('/staff/clubs');
		await page.waitForURL('**/staff/groups/clubs', { timeout: 15000 });

		const table = page.locator('table');
		// `goto` resolves before an awaited remote query commits, so wait for a row
		// rather than asserting on an empty <main>.
		await expect(table.getByText(SEED_CLUB_NAME)).toBeVisible();
		await expect(table.getByText(SEED_COMMITTEE_NAME)).toHaveCount(0);

		// A band the band fixtures seed. If the kind filter were missing, every
		// band in the database would be on this page.
		await expect(table.getByText(SEED_PUBLIC_BAND_NAME)).toHaveCount(0);
	});

	test('Committees are a Groups view, and a committee shows its applications apart', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/committees');
		await page.waitForURL('**/staff/groups/committees', { timeout: 15000 });

		const card = page.getByRole('button', { name: new RegExp(SEED_COMMITTEE_NAME) });
		await expect(card).toBeVisible();
		// One Groups row replaces the three, so the old addresses are not in the nav.
		const nav = page.locator('aside ul.menu').first();
		await expect(nav.locator('a[href="/staff/groups"]')).toHaveCount(1);
		await expect(nav.locator('a[href="/staff/clubs"]')).toHaveCount(0);
		await expect(nav.locator('a[href="/staff/committees"]')).toHaveCount(0);
		// The view tabs sit in the page header, above what the chosen view holds.
		await expect(
			page.locator('[data-page-header] a[href="/staff/groups/committees"]')
		).toHaveAttribute('aria-current', 'page');

		// The card opens the record beside the list, which links on to its page.
		// The seeded committee carries one open application; its answer is
		// fixture data, so it identifies the application without the card's copy.
		const answer = 'Booked a basement series for two years.';
		await card.click();
		const panel = page.getByRole('dialog');
		await expect(panel.getByText(answer)).toBeVisible();
		await panel.locator(`a[href="/staff/groups/${SEED_COMMITTEE_ID}"]`).click();

		// The fixture's own id, not a uuid — it is seeded rather than created.
		await page.waitForURL(`**/staff/groups/${SEED_COMMITTEE_ID}`, { timeout: 15000 });
		await expect(page.getByText(answer)).toBeVisible();

		// Every committee takes applications, so the policy is stated, not offered.
		await expect(page.locator('select:is([name="joinPolicy"], [name^="joinPolicy/"])')).toHaveCount(
			0
		);

		// And a committee's old address lands on its record.
		await page.goto(`/staff/committees/${SEED_COMMITTEE_ID}`);
		await page.waitForURL(`**/staff/groups/${SEED_COMMITTEE_ID}`, { timeout: 15000 });
		await expect(page.getByRole('heading', { name: SEED_COMMITTEE_NAME })).toBeVisible();
	});

	test('creates a club and appoints its first chair in one step', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/groups/clubs');

		await page.getByTestId('create-group').click();

		const name = `E2E Songwriter Circle ${Date.now()}`;
		await page.locator('input:is([name="name"], [name^="name/"])').fill(name);

		// The chair picker is a typeahead over every member, not a select.
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

		await page.getByRole('dialog').locator('button[type="submit"]').click();

		// Straight to the new group's page, which is what carries the proof: the
		// appointee is a chair already, with nothing to accept.
		await page.waitForURL(/\/staff\/groups\/[0-9a-f-]{36}/, { timeout: 15000 });
		await expect(page.getByRole('heading', { name })).toBeVisible();
		await expect(page.getByText(SEED_TARGET_NAME).first()).toBeVisible();
	});
});
