import { test, expect, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_VENUE_ARCHIVED_NAME,
	SEED_VENUE_OFFSITE_NAME,
	SEED_VENUE_ROOM_NAME
} from './fixtures/seed-venues';

/**
 * Venues exist to answer one question: does a show here hold the practice room?
 *
 * Everything asserted below is a consequence of that, and none of it is
 * reachable from a unit test — the refusal is a form issue rendered by the
 * server, and the two branches of the Space Reservation card are a page reading
 * a joined column.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
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
	 * The refusal that matters. Ticking the box for a show somewhere else asks for
	 * something that cannot happen, and the useful answer is to say so — not an
	 * event that quietly came out different from the form.
	 *
	 * The picker withdraws the toggle once an off-site venue is chosen, so this
	 * asserts the withdrawal, which is the same rule one step earlier.
	 */
	test('an off-site venue withdraws the room hold', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/productions');

		await page.getByRole('button', { name: 'New Event' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });

		// The toggle is there while the show is in our room.
		await expect(dialog.getByText('Reserve practice space')).toBeVisible({ timeout: 15000 });

		await dialog.locator('select[name="venueId"]').selectOption({ label: SEED_VENUE_OFFSITE_NAME });

		await expect(dialog.getByText('Reserve practice space')).toHaveCount(0);
		await expect(dialog.getByText('Off-site, so the practice space stays bookable')).toBeVisible();

		// And back: choosing the room again offers it, so this is a branch rather
		// than a one-way door.
		await dialog.locator('select[name="venueId"]').selectOption({ label: 'The practice room' });
		await expect(dialog.getByText('Reserve practice space')).toBeVisible();
	});
});
