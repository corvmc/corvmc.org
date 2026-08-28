import { test, expect, type Page } from '@playwright/test';
import {
	SEED_SPLIT_CMC_DRAFT_TITLE,
	SEED_SPLIT_CMC_LIVE_TITLE,
	SEED_SPLIT_PENDING_TITLE,
	SEED_SPLIT_LIVE_TITLE,
	SEED_SPLIT_DRAFT_TITLE,
	SEED_SPLIT_MEMBER_NAME
} from './fixtures/seed-events-split';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * The staff events split: Productions versus Calendar.
 *
 * `/staff/events` and `/staff/calendar` read one table through two lenses, and
 * the thing worth proving is that neither is a subset of the other. A CMC draft
 * is production work and must never reach the calendar; a listing is not
 * production work and must never reach Productions; a published CMC show is on
 * both, because it is a thing being run *and* a thing the public can see.
 *
 * Each is a negative on one page paired with a positive on the other, which no
 * unit test can assert together — and a filter defaulting the wrong way would
 * satisfy either half alone.
 *
 * Every row read here comes from `seed-events-split`, which exists because
 * `community-events.e2e.ts` approves and deletes the rows it seeds.
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

	test('Productions holds CMC work, including drafts, and no listings', async ({ page }) => {
		await page.goto('/staff/events');
		await expect(page.getByRole('heading', { name: 'Productions' })).toBeVisible();

		// A CMC draft is a show being built. This is the only page that has it.
		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_CMC_LIVE_TITLE)).toBeVisible();

		// Listings are somebody else's show. Scoped out by source, not status, so
		// a *published* one is absent too.
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_LIVE_TITLE)).toHaveCount(0);
	});

	test('the Calendar opens on the review queue, naming who posted', async ({ page }) => {
		await page.goto('/staff/calendar');
		await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
		await expect(page.getByLabel('Status')).toHaveValue('review');

		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toBeVisible();
		// The fact the old queue never showed: who is accountable for the row.
		await expect(page.getByRole('link', { name: SEED_SPLIT_MEMBER_NAME })).toBeVisible();

		// Published rows are on the calendar, not in the queue.
		await expect(page.getByText(SEED_SPLIT_LIVE_TITLE)).toHaveCount(0);
	});

	test('a draft of any source never reaches the Calendar, at any filter', async ({ page }) => {
		await page.goto('/staff/calendar');
		await page.getByLabel('Status').selectOption('all');
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toBeVisible();

		// "Everything" means every reviewable-or-public status. A draft is
		// neither: a CMC one is unfinished production work, and a community one is
		// a member's private working copy no staffer should read.
		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_DRAFT_TITLE)).toHaveCount(0);
	});

	test('the calendar view carries every source, ours included', async ({ page }) => {
		await page.goto('/staff/calendar');
		await page.getByLabel('Status').selectOption('calendar');

		// Both, together, on one page: seeing a member's listing beside our own
		// show on a nearby date is how a duplicate gets caught at all.
		await expect(page.getByText(SEED_SPLIT_LIVE_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_CMC_LIVE_TITLE)).toBeVisible();
		await expect(page.getByLabel('Source')).toHaveValue('');
	});

	test('the old review URL still lands on the queue', async ({ page }) => {
		await page.goto('/staff/events?status=pending_review');
		await expect(page).toHaveURL(/\/staff\/calendar$/);
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toBeVisible();
	});
});
