import { test, expect, type Page } from '@playwright/test';
import {
	SEED_SPLIT_CMC_DRAFT_TITLE,
	SEED_SPLIT_CMC_LIVE_ID,
	SEED_SPLIT_CMC_LIVE_TITLE,
	SEED_SPLIT_PENDING_ID,
	SEED_SPLIT_PENDING_TITLE,
	SEED_SPLIT_LIVE_TITLE,
	SEED_SPLIT_DRAFT_TITLE,
	SEED_SPLIT_NEAR_TITLE,
	SEED_SPLIT_FAR_TITLE,
	SEED_SPLIT_MEMBER_NAME
} from './fixtures/seed-events-split';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * The staff events split, after the URL reversal.
 *
 * `/staff/events` is the calendar and the general event view — the address
 * every event ref resolves to, so it is where a staffer lands by default from
 * anywhere in the panel. `/staff/productions` and `/staff/events/[id]/production`
 * are the CMC work surfaces, sitting on their own paths so they can be gated
 * later without making every inbound link conditional.
 *
 * What is worth a round trip: neither index is a subset of the other, the
 * general view carries no production controls, the console refuses a listing,
 * and the two-hour window really is a window rather than a day.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('staff events split', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsStaff(page);
	});

	// It shipped at /staff/calendar for a few hours, and the notification rows
	// written in that window keep that href forever.
	test('the address the calendar briefly held still redirects', async ({ page }) => {
		await page.goto('/staff/calendar');
		await expect(page).toHaveURL(/\/staff\/events$/);
		await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
	});

	test('the calendar holds /staff/events and opens on the queue', async ({ page }) => {
		await page.goto('/staff/events');
		await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
		await expect(page.getByLabel('Status')).toHaveValue('review');

		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toBeVisible();
		await expect(page.getByRole('link', { name: SEED_SPLIT_MEMBER_NAME })).toBeVisible();
	});

	test('Productions holds CMC work, including drafts, and no listings', async ({ page }) => {
		await page.goto('/staff/productions');
		await expect(page.getByRole('heading', { name: 'Productions' })).toBeVisible();

		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_LIVE_TITLE)).toHaveCount(0);
	});

	test('a draft of any source never reaches the calendar, at any filter', async ({ page }) => {
		await page.goto('/staff/events');
		await page.getByLabel('Status').selectOption('all');
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toBeVisible();

		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_DRAFT_TITLE)).toHaveCount(0);
	});

	// The filter lives in the URL so a reload and a back-out both land on the
	// view the staffer left. This is the behaviour `replaceState()` could not
	// give: it rewrites the address bar without telling the router, so the entry
	// pushed on the next navigation overwrote it and Back returned to the
	// default queue instead of the filtered calendar.
	test('a filter survives a reload and a round trip into an event', async ({ page }) => {
		await page.goto('/staff/events');
		await page.getByLabel('Status').selectOption('all');
		await expect(page).toHaveURL(/\?view=all$/);

		await page.reload();
		await expect(page.getByLabel('Status')).toHaveValue('all');

		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}`);
		await page.goBack();
		await expect(page).toHaveURL(/\?view=all$/);
		await expect(page.getByLabel('Status')).toHaveValue('all');
	});

	// Returning every control to its default returns the address to a bare path,
	// so a staffer can tell at a glance whether anything is filtered.
	test('clearing the filters clears the query string', async ({ page }) => {
		await page.goto('/staff/events?view=all&source=cmc');
		await expect(page.getByLabel('Source')).toHaveValue('cmc');

		await page.getByLabel('Status').selectOption('review');
		await page.getByLabel('Source').selectOption('');
		await expect(page).toHaveURL(/\/staff\/events$/);
	});

	test('the general view carries facts and no production controls', async ({ page }) => {
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}`);
		await expect(page.getByRole('heading', { name: SEED_SPLIT_PENDING_TITLE })).toBeVisible();

		// Who is accountable, said once — the second "Created by" card is gone.
		await expect(page.getByRole('heading', { name: 'Posted by' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Created by' })).toHaveCount(0);

		// Production controls belong to the console. Assert on the card headings,
		// not on text: the sidebar's own Space and Volunteering sections put
		// "Space Reservations" and "Volunteer…" on every page in the panel.
		await expect(page.getByRole('heading', { name: 'Space Reservation' })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Volunteer Shifts' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Manage production' })).toHaveCount(0);
	});

	test('the window is two hours, not the day', async ({ page }) => {
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}`);
		await expect(page.getByRole('heading', { name: 'Within two hours' })).toBeVisible();

		// Both are on the same date. Only a real window tells them apart, which is
		// the whole reason this is not a day query.
		await expect(page.getByText(SEED_SPLIT_NEAR_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_FAR_TITLE)).toHaveCount(0);
	});

	test('a production reaches its console, and a listing is turned away', async ({ page }) => {
		await page.goto(`/staff/events/${SEED_SPLIT_CMC_LIVE_ID}`);
		await expect(page.getByRole('link', { name: 'Manage production' })).toBeVisible();

		await page.goto(`/staff/events/${SEED_SPLIT_CMC_LIVE_ID}/production`);
		await expect(page.getByRole('heading', { name: SEED_SPLIT_CMC_LIVE_TITLE })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Space Reservation' })).toBeVisible();

		// The console is tabbed now, and the staffing lives on Advance. Reached by
		// the tab rather than by `?tab=`, because what this asserts is that the
		// console is whole — every part of it still reachable from where you land.
		await page.getByRole('tab', { name: 'Advance' }).click();
		await expect(page.getByRole('heading', { name: 'Volunteer Shifts' })).toBeVisible();

		// The console has nothing to say about a listing, so a hand-typed URL goes
		// back to the view that does.
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}/production`);
		await expect(page).toHaveURL(new RegExp(`/staff/events/${SEED_SPLIT_PENDING_ID}$`));
	});
});
