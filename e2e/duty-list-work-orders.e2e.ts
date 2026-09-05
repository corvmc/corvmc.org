import { test, expect, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_VOL_ADVANCE_ID,
	SEED_VOL_ADVANCE_TASK_DONE,
	SEED_VOL_ADVANCE_TASK_OPEN,
	SEED_VOL_ADVANCE_ROLE_NAME,
	SEED_VOL_EVENT_ID
} from './fixtures/seed-volunteering';

/**
 * The advance half of a duty list has to be visible somewhere.
 *
 * `applyDutyList` turns an item carrying only a `dueOffsetMinutes` into an
 * *unscheduled* work order and writes its `tasks[]` into `work_task`. Both
 * writes worked; nothing read either back. `listShifts` filters
 * `starts_at IS NOT NULL` — its own comment says those rows belong in "the
 * coordinator's needs-scheduling queue", which did not exist — and the
 * production console's Volunteer Shifts card reads through that same query, so
 * a show could carry six open advance tasks while the page said nobody was
 * staffing it. `listWorkTasks` and `setWorkTaskDone` had no callers at all.
 *
 * These are exactly the assertions a unit test cannot make: the services were
 * correct and specced the whole time. What was missing was a surface.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('duty lists — the unscheduled half', () => {
	test('an advance work order reaches the coordinator dashboard', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/volunteer');

		const card = page.locator('section, div').filter({ hasText: 'Needs scheduling' }).last();
		await expect(card.getByRole('link', { name: SEED_VOL_ADVANCE_ROLE_NAME })).toBeVisible();
	});

	test('and the show it is for says so, beside the timed shifts', async ({ page }) => {
		await loginAsStaff(page);
		// The console is tabbed, and the advance work is the Advance tab's whole
		// subject. `?tab=` is the addressable form, so this also pins that a link
		// somebody pastes lands where it says it does.
		await page.goto(`/staff/events/${SEED_VOL_EVENT_ID}/production?tab=advance`);

		await expect(page.getByRole('heading', { name: 'Advance' })).toBeVisible();
		await expect(
			page.getByRole('link', { name: SEED_VOL_ADVANCE_ROLE_NAME }).first()
		).toBeVisible();
	});

	/**
	 * The checklist was write-only: `applyDutyList` created the rows and no page
	 * rendered them, so a duty list promised a list of work and then showed none
	 * of it to whoever was accountable for doing it.
	 */
	test('its checklist renders, and a box stays ticked', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/volunteer/shifts/${SEED_VOL_ADVANCE_ID}`);

		// A deadline is not a window, and the page must not print an empty range.
		await expect(page.getByText('a time to be arranged')).toHaveCount(0);

		await expect(page.getByText(SEED_VOL_ADVANCE_TASK_DONE)).toBeVisible();
		const open = page.getByLabel(SEED_VOL_ADVANCE_TASK_OPEN);
		await expect(open).not.toBeChecked();

		await open.check();

		// Survives the round trip rather than only the click: the tick goes through
		// `setWorkTaskDone`, which refreshes the page query it was read from.
		await page.reload();
		await expect(page.getByLabel(SEED_VOL_ADVANCE_TASK_OPEN)).toBeChecked();
	});
});
