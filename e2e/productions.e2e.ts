import { test, expect, type Page } from './fixtures/test';
import { eq } from 'drizzle-orm';
import { signInAs } from './fixtures/auth';
import { readLocalDb } from './fixtures/platform-db';
import { production } from '../src/lib/server/db/schema/production';
import { eventListing } from '../src/lib/server/db/schema/event';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_VENUE_OFFSITE_NAME } from './fixtures/seed-venues';
import {
	SEED_PRODUCTION_BARE_EVENT_ID,
	SEED_PRODUCTION_EMPTY_EVENT_TITLE,
	SEED_PRODUCTION_EVENT_ID,
	SEED_PRODUCTION_EVENT_TITLE
} from './fixtures/seed-productions';

/**
 * The production record: what a night needs beyond being advertised.
 *
 * None of this is reachable from a unit test. Opening a production is a form
 * post that changes what the *event* page offers; the index's three new columns
 * are a page reading joined data it did not read before; and the tab set is
 * shallow routing, which by definition only exists in a browser.
 */

// Check quickly once, then back off: `readLocalDb` shares the preview's file.
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

/** The status of the production on a listing's project, or undefined. */
function productionStatusOf(eventId: string) {
	return readLocalDb((db) =>
		db
			.select({ status: production.status })
			.from(production)
			.innerJoin(eventListing, eq(eventListing.projectId, production.projectId))
			.where(eq(eventListing.id, eventId))
	).then(([row]) => row?.status);
}

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('productions', () => {
	/**
	 * The Production tab's empty state is what opens the record — the page that
	 * explains a production is the page that makes one (#976) — and the record
	 * shows on the event page afterwards: its lead joins the Crew box (#3270).
	 */
	test('a production is opened from the Production tab and shows on the event page', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}`);

		const tab = page
			.getByRole('main')
			.locator(`a[href="/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}?tab=production"]`)
			.first();
		await expect(tab).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('crew-lead')).toHaveCount(0);
		await tab.click();
		await page.waitForURL(/\?tab=production$/);

		const open = page.locator('form[action$="createProduction"] button[type=submit]').first();
		await expect(open).toBeVisible({ timeout: 15000 });
		await open.click();

		await expect
			.poll(() => productionStatusOf(SEED_PRODUCTION_BARE_EVENT_ID), DB_POLL)
			.toBe('draft');
		await expect(page.getByTestId('crew-lead')).toBeVisible({ timeout: 15000 });

		// A draft can be offered.
		const offer = page.locator('[data-testid="production-move"][data-to="offered"]');
		await expect(offer).toBeVisible({ timeout: 15000 });
		await offer.click();
		await page.getByRole('dialog').locator('button[type=submit]').click();

		// It has to be written, and survive a reload: a control reflecting
		// optimistic client state would pass in the page and have written nothing.
		await expect
			.poll(() => productionStatusOf(SEED_PRODUCTION_BARE_EVENT_ID), DB_POLL)
			.toBe('offered');
		await page.reload();
		await expect(page.getByRole('main').locator('[data-status="offered"]').first()).toBeVisible({
			timeout: 15000
		});
	});

	/**
	 * Productions and Calendar are two lists (#3112). Productions holds production
	 * records, with their status and venue; a show with no production is on the
	 * Calendar only.
	 */
	test('Productions lists the production with its status and venue', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/productions');

		const row = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EVENT_TITLE });
		await expect(row).toBeVisible({ timeout: 15000 });
		// A badge for the production and one for its listing.
		await expect(row.locator('[data-status]')).toHaveCount(2);
		await expect(row.locator('[data-status="published"]')).toBeVisible();
		await expect(row.getByText(SEED_VENUE_OFFSITE_NAME)).toBeVisible();
		// The row opens its event.
		await expect(row.locator(`a[href="/staff/events/${SEED_PRODUCTION_EVENT_ID}"]`)).toBeVisible();

		await expect(
			page.locator('tr').filter({ hasText: SEED_PRODUCTION_EMPTY_EVENT_TITLE })
		).toHaveCount(0);
	});

	test('the Calendar links a listing to its production, and only one that has it', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/events?date=any');

		const row = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EVENT_TITLE });
		await expect(row).toBeVisible({ timeout: 15000 });
		await expect(
			row.locator(`a[href="/staff/events/${SEED_PRODUCTION_EVENT_ID}?tab=production"]`)
		).toBeVisible();

		const empty = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EMPTY_EVENT_TITLE });
		await expect(empty).toBeVisible();
		await expect(empty.getByTestId('production-link')).toHaveCount(0);
	});

	/**
	 * A tab is an address (#3270): the console's old URL, inner tab and all,
	 * lands on the Production tab, and the Listing tab is the bare event URL.
	 */
	test('the old console URL opens the Production tab, and Listing is the event URL', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto(`/staff/events/${SEED_PRODUCTION_EVENT_ID}/production?tab=advance`);

		await expect(page).toHaveURL(
			new RegExp(`/staff/events/${SEED_PRODUCTION_EVENT_ID}\\?tab=production$`)
		);
		await expect(page.getByTestId('related-add-shift')).toBeVisible({ timeout: 15000 });

		await page.goto(`/staff/events/${SEED_PRODUCTION_EVENT_ID}`);
		await expect(page).toHaveURL(new RegExp(`/staff/events/${SEED_PRODUCTION_EVENT_ID}$`));
		await expect(page.getByTestId('edit-listing')).toBeVisible({ timeout: 15000 });
	});
});
