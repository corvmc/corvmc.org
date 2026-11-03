import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { signInAs } from './fixtures/auth';
import { readLocalDb } from './fixtures/platform-db';
import { production } from '../src/lib/server/db/schema/production';
import { eventListing } from '../src/lib/server/db/schema/event';
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
	 * One entry from the event page, and the console's empty state is what opens
	 * the record — the page that explains a production is the page that makes one
	 * (#976). Creating it has to show on the event page afterwards, which is the
	 * whole of that finding.
	 */
	test('a production is opened from the console and shows on the event page', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}`);

		// Before: one entry into the console, not two.
		const entry = page.locator(
			`a[href="/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}/production"]`
		);
		await expect(entry).toHaveCount(1, { timeout: 15000 });
		await entry.click();
		await page.waitForURL(/\/production$/);

		const open = page.locator('form[action$="createProduction"] button[type=submit]');
		await expect(open).toBeVisible({ timeout: 15000 });
		await open.click();

		// The button is the whole form, so its own disappearance is the receipt;
		// the record that replaces it offers to take the producer's job.
		await expect(open).toHaveCount(0, { timeout: 15000 });
		const record = page.getByTestId('production-record');
		await expect(record.locator('input[name="producer"]')).toHaveValue('me', { timeout: 15000 });
		await expect
			.poll(() => productionStatusOf(SEED_PRODUCTION_BARE_EVENT_ID), DB_POLL)
			.toBe('draft');

		// #976: the record is visible from the page it belongs to, which before
		// this changed in no way at all except a button vanishing: its card adds
		// a second way into the console.
		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}`);
		await expect(entry).toHaveCount(2, { timeout: 15000 });

		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}/production`);

		// A draft's first move is the offer, rendered first in the record's header.
		const badge = record.locator('.badge').first();
		await expect(badge).toBeVisible({ timeout: 15000 });
		const draftBadge = await badge.textContent();
		await record.getByRole('button').first().click();
		await page.getByRole('dialog').locator('button[type=submit]').click();

		// It has to be written, and survive a reload: a control reflecting
		// optimistic client state would pass in the page and have written nothing.
		await expect
			.poll(() => productionStatusOf(SEED_PRODUCTION_BARE_EVENT_ID), DB_POLL)
			.toBe('offered');
		await page.reload();
		await expect(badge).toBeVisible({ timeout: 15000 });
		await expect(badge).not.toHaveText(draftBadge ?? '');
	});

	/**
	 * The acceptance test for the absorb decision. The Productions view is still
	 * the CMC event index — it did not become a table of production records — but
	 * it now answers the questions the production table was wanted for, on the
	 * rows it already had.
	 */
	test('the index carries the production, the venue and the bill on one row', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/projects/productions');

		const row = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EVENT_TITLE });
		await expect(row).toBeVisible({ timeout: 15000 });
		// The production's own status column: a badge when there is one.
		await expect(row.locator('td').nth(2).locator('.badge')).toBeVisible();
		await expect(row.getByText(SEED_VENUE_OFFSITE_NAME)).toBeVisible();
		// The bill is an avatar stack, so the acts are its accessible name, not text.
		await expect(row.getByLabel(SEED_PRODUCTION_HEADLINER)).toBeVisible();

		// A CMC show with no production reads as absent, not as blank — the two
		// have to be told apart, which is the reason the column carries words. A
		// row of its own, because the sibling test above opens one on the other.
		const empty = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EMPTY_EVENT_TITLE });
		const absent = empty.locator('td').nth(2);
		await expect(absent).toBeVisible();
		await expect(absent).not.toBeEmpty();
		await expect(absent.locator('.badge')).toHaveCount(0);
	});

	test('filtering by venue narrows the index to the off-site shows', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/projects/productions');
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

		await expect(page.getByTestId('volunteer-shifts')).toBeVisible({ timeout: 15000 });

		await page.locator('#tab-overview').click();
		await expect(page).toHaveURL(new RegExp(`/production$`));
		await expect(page.locator('form[action$="setProductionProducer"]')).toBeVisible();
	});
});
