import { test, expect, type Page } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_VENUE_ARCHIVED_NAME,
	SEED_VENUE_OFFSITE_NAME,
	SEED_VENUE_ROOM_NAME
} from './fixtures/seed-venues';
import { SEED_EVENT_DATE, SEED_EVENT_TITLE_PREFIX } from './fixtures/seed-staff-event';

/**
 * Venues exist to answer one question: does a show here hold the practice room?
 *
 * Everything asserted below is a consequence of that, and none of it is
 * reachable from a unit test — the refusal is a form issue rendered by the
 * server, and the two branches of the Space Reservation card are a page reading
 * a joined column.
 */

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('venues', () => {
	test('the room leads the list and says it is ours', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/venues');

		const roomRow = page.locator('tr').filter({ hasText: SEED_VENUE_ROOM_NAME });
		await expect(roomRow).toBeVisible({ timeout: 15000 });
		await expect(roomRow.getByText('Our room')).toBeVisible();

		await expect(page.locator('tr').filter({ hasText: SEED_VENUE_OFFSITE_NAME })).toBeVisible();
	});

	/**
	 * Archiving takes a venue off the picker without taking it off the events that
	 * already name it, so the list has to be able to show what the picker hides.
	 */
	test('an archived venue is out of the list until asked for', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/venues');

		await expect(page.locator('tr').filter({ hasText: SEED_VENUE_ARCHIVED_NAME })).toHaveCount(0, {
			timeout: 15000
		});

		await page.goto('/staff/venues?archived=1');
		await expect(page.locator('tr').filter({ hasText: SEED_VENUE_ARCHIVED_NAME })).toBeVisible({
			timeout: 15000
		});
	});

	/**
	 * The refusal that matters: a hold for a show somewhere else cannot happen,
	 * and `updateEvent` says so. The console's edit form withdraws the toggle once
	 * an off-site venue is chosen, which is the same rule one step earlier. The
	 * create modal no longer asks about the room at all.
	 */
	test('an off-site venue withdraws the room hold', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');

		// The fixture sweeps this prefix, and the event is never given a hold.
		const title = `${SEED_EVENT_TITLE_PREFIX} venue ${Date.now()}`;
		await page.getByRole('button', { name: 'Create Listing' }).click();
		await page.locator('input[name="title"]').fill(title);
		await page.locator('input[name="eventDate"]').fill(SEED_EVENT_DATE);
		await page.locator('input[name="eventStartTime"]').fill('19:00');
		await page.locator('input[name="eventEndTime"]').fill('22:00');
		await page.getByRole('dialog').getByRole('button', { name: 'Create Listing' }).click();
		await page.waitForURL(/\/staff\/events\/[^/]+$/, { timeout: 15000 });
		await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15000 });
		// Create lands with `?edit=1`; reloaded bare so the test opens Edit itself.
		await page.goto(new URL(page.url()).pathname);
		await page.getByRole('button', { name: 'Edit' }).click();

		// The toggle is there while the show is in our room.
		await expect(page.getByRole('checkbox', { name: 'Reserve practice space' })).toBeVisible({
			timeout: 15000
		});

		await page.locator('select[name="venueId"]').selectOption({ label: SEED_VENUE_OFFSITE_NAME });

		await expect(page.getByRole('checkbox', { name: 'Reserve practice space' })).toHaveCount(0);
		await expect(page.getByText('Off-site, so the practice space stays bookable')).toBeVisible();

		// And back: choosing the room again offers it, so this is a branch rather
		// than a one-way door.
		await page.locator('select[name="venueId"]').selectOption({ label: 'The practice room' });
		await expect(page.getByRole('checkbox', { name: 'Reserve practice space' })).toBeVisible();
	});
});
