import { test, expect, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_VENUE_OFFSITE_NAME, SEED_VENUE_ROOM_NAME } from './fixtures/seed-venues';
import {
	SEED_PRODUCTION_BARE_EVENT_ID,
	SEED_PRODUCTION_EMPTY_EVENT_TITLE,
	SEED_PRODUCTION_EVENT_ID,
	SEED_PRODUCTION_EVENT_TITLE,
	SEED_PRODUCTION_HEADLINER
} from './fixtures/seed-productions';

/**
 * The production record: what a night needs beyond being advertised.
 *
 * None of this is reachable from a unit test. Opening a production is a form
 * post that changes what the *event* page offers; the index's three new columns
 * are a page reading joined data it did not read before; and the tab set is
 * shallow routing, which by definition only exists in a browser.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('productions', () => {
	/**
	 * The event page owns the listing's lifecycle and the console owns the
	 * production — so the only way one comes into existence is from the event
	 * page, and once it exists that button has to go away.
	 */
	test('a production is opened from the event page and advances from the console', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}`);

		const add = page.getByRole('button', { name: 'Add production' });
		await expect(add).toBeVisible({ timeout: 15000 });
		await add.click();

		// The button is the whole form, so its own disappearance is the receipt.
		await expect(add).toHaveCount(0, { timeout: 15000 });

		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}/production`);
		await expect(page.getByText('Nobody yet')).toBeVisible({ timeout: 15000 });

		// Which moves are offered *is* the status, and it is the assertion that
		// cannot pass against a badge whose text happens to match the listing's.
		const offer = page.getByRole('button', { name: 'Send the offer' });
		await expect(offer).toBeVisible();
		await offer.click();
		// Action's dialog repeats the label on its submit.
		await offer.last().click();

		// `offered` walks back rather than forward, so its appearance is proof the
		// transition landed and not just that the page re-rendered.
		await expect(page.getByRole('button', { name: 'Pull the offer' })).toBeVisible({
			timeout: 15000
		});

		// It has to survive a reload: a control reflecting optimistic client state
		// would pass every assertion above and still have written nothing.
		await page.reload();
		await expect(page.getByRole('button', { name: 'Pull the offer' })).toBeVisible({
			timeout: 15000
		});
	});

	/**
	 * The acceptance test for the absorb decision. `/staff/productions` is still
	 * the CMC event index — it did not become a table of production records — but
	 * it now answers the questions the production table was wanted for, on the
	 * rows it already had.
	 */
	test('the index carries the production, the venue and the bill on one row', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/productions');

		const row = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EVENT_TITLE });
		await expect(row).toBeVisible({ timeout: 15000 });
		await expect(row.getByText('Draft', { exact: true })).toBeVisible();
		await expect(row.getByText(SEED_VENUE_OFFSITE_NAME)).toBeVisible();
		await expect(row.getByText(SEED_PRODUCTION_HEADLINER)).toBeVisible();

		// A CMC show with no production reads as absent, not as blank — the two
		// have to be told apart, which is the reason the column carries words. A
		// row of its own, because the sibling test above opens one on the other.
		const empty = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EMPTY_EVENT_TITLE });
		await expect(empty.getByText('No production')).toBeVisible();
	});

	test('filtering by venue narrows the index to the off-site shows', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/productions');
		await expect(page.locator('tr').filter({ hasText: SEED_PRODUCTION_EVENT_TITLE })).toBeVisible({
			timeout: 15000
		});

		await page.getByLabel('Venue').selectOption({ label: SEED_VENUE_OFFSITE_NAME });

		await expect(page.locator('tr').filter({ hasText: SEED_PRODUCTION_EVENT_TITLE })).toBeVisible({
			timeout: 15000
		});
		// Every other fixture's event is in the room, so the room's name going
		// missing is what says the filter reached the query rather than the DOM.
		await expect(page.locator('tr').filter({ hasText: SEED_VENUE_ROOM_NAME })).toHaveCount(0);
	});

	/**
	 * The tabs are shallow routing: `?tab=` has to be readable on load — a link
	 * somebody pastes is the whole point — and clicking one must not navigate,
	 * because `FormGuard` hooks `beforeNavigate` and the console's edit form is
	 * dirtyable.
	 */
	test('a tab is addressable and switching one does not navigate', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/events/${SEED_PRODUCTION_EVENT_ID}/production?tab=advance`);

		await expect(page.getByRole('heading', { name: 'Volunteer Shifts' })).toBeVisible({
			timeout: 15000
		});

		await page.getByRole('tab', { name: 'Overview' }).click();
		await expect(page).toHaveURL(new RegExp(`/production$`));
		await expect(page.getByText('Producer')).toBeVisible();
	});
});
