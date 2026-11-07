import { eq } from 'drizzle-orm';
import { test, expect } from './fixtures/test';
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
import {
	SEED_SPLIT_CMC_DRAFT_TITLE,
	SEED_SPLIT_CMC_LIVE_ID,
	SEED_SPLIT_CMC_LIVE_TITLE,
	SEED_SPLIT_DRAFT_TITLE,
	SEED_SPLIT_FAR_TITLE,
	SEED_SPLIT_LIVE_TITLE,
	SEED_SPLIT_MEMBER_NAME,
	SEED_SPLIT_NEAR_TITLE,
	SEED_SPLIT_PENDING_ID,
	SEED_SPLIT_PENDING_TITLE
} from './fixtures/seed-events-split';
import {
	SEED_BLOCKED_EVENT_ID,
	SEED_BLOCKED_EVENT_TITLE,
	SEED_READY_EVENT_ID,
	SEED_READY_EVENT_TITLE
} from './fixtures/seed-publish-blockers';

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

// One mutation (the bare event's production), so a retry after it fails on the
// entry count: it has spent its row. Every other step only reads.
test('staff work a show from calendar to console', async ({ page }) => {
	test.setTimeout(180_000);
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });

	await test.step('the calendar holds its old address and every listing', async () => {
		await page.goto('/staff/calendar');
		await expect(page).toHaveURL(/\/staff\/events$/);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

		const pending = page.getByRole('row').filter({ hasText: SEED_SPLIT_PENDING_TITLE });
		await expect(pending).toBeVisible();
		await expect(pending.getByRole('link', { name: SEED_SPLIT_MEMBER_NAME })).toBeVisible();

		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_DRAFT_TITLE)).toHaveCount(0);

		// Listings waiting on staff are pinned above the dates: the first group row,
		// before the second.
		await expect
			.poll(() =>
				page.getByRole('row').evaluateAll((rows, title) => {
					const groups = rows.flatMap((r, i) => (r.querySelector('.cell-group') ? [i] : []));
					const at = rows.findIndex((r) => r.textContent?.includes(title));
					return groups[0] === 1 && at > groups[0] && at < (groups[1] ?? -1);
				}, SEED_SPLIT_PENDING_TITLE)
			)
			.toBe(true);
		await expect(page.getByLabel('Status')).toHaveCount(0);
	});

	await test.step('Productions holds CMC work and carries the row, then filters by venue', async () => {
		await page.goto('/staff/projects/productions');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_LIVE_TITLE)).toHaveCount(0);

		const row = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EVENT_TITLE });
		await expect(row).toBeVisible({ timeout: 15000 });
		await expect(row.locator('td').nth(2).locator('.badge')).toBeVisible();
		await expect(row.getByText(SEED_VENUE_OFFSITE_NAME)).toBeVisible();
		// The bill is an avatar stack, so the acts are its accessible name, not text.
		await expect(row.getByLabel(SEED_PRODUCTION_HEADLINER)).toBeVisible();

		// No production reads as absent, not as blank: the column carries words.
		const empty = page.locator('tr').filter({ hasText: SEED_PRODUCTION_EMPTY_EVENT_TITLE });
		const absent = empty.locator('td').nth(2);
		await expect(absent).toBeVisible();
		await expect(absent).not.toBeEmpty();
		await expect(absent.locator('.badge')).toHaveCount(0);

		await page.getByLabel('Venue').selectOption({ label: SEED_VENUE_OFFSITE_NAME });

		await expect(row).toBeVisible({ timeout: 15000 });
		// Every other fixture's event is in the room, so the room's name going missing
		// is what says the filter reached the query rather than the DOM.
		await expect(page.locator('tr').filter({ hasText: SEED_VENUE_ROOM_NAME })).toHaveCount(0);
	});

	await test.step('the general view carries facts, no controls, and a two-hour window', async () => {
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}`);
		await expect(page.getByRole('heading', { name: SEED_SPLIT_PENDING_TITLE })).toBeVisible();

		await expect(
			page.getByRole('main').getByRole('link', { name: SEED_SPLIT_MEMBER_NAME })
		).toHaveCount(1);

		// Scoped to the cards: the sidebar's own sections are on every page.
		await expect(page.getByTestId('space-hold')).toHaveCount(0);
		await expect(page.getByTestId('volunteer-shifts')).toHaveCount(0);
		await expect(
			page.locator(`a[href="/staff/events/${SEED_SPLIT_PENDING_ID}/production"]`)
		).toHaveCount(0);

		// Both are on the same date; only a real window tells them apart.
		await expect(page.getByRole('row').filter({ hasText: SEED_SPLIT_NEAR_TITLE })).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_FAR_TITLE)).toHaveCount(0);
	});

	await test.step('the publish dialog warns on a blocked listing', async () => {
		await page.goto(`/staff/events/${SEED_BLOCKED_EVENT_ID}`);
		await expect(page.getByRole('heading', { name: SEED_BLOCKED_EVENT_TITLE })).toBeVisible({
			timeout: 15000
		});
		await page.getByTestId('publish-event').click();

		const dialog = page.getByRole('dialog');
		// The seed leaves out the poster and the description, and nothing else.
		await expect(dialog.getByRole('alert').locator('li')).toHaveCount(2, { timeout: 15000 });
		await expect(dialog.getByLabel('Why publish now?')).toBeVisible();
		await expect(dialog.locator('button[type="submit"]')).toBeEnabled();
	});

	await test.step('the publish dialog asks nothing of a ready listing', async () => {
		await page.goto(`/staff/events/${SEED_READY_EVENT_ID}`);
		await expect(page.getByRole('heading', { name: SEED_READY_EVENT_TITLE })).toBeVisible({
			timeout: 15000
		});
		await page.getByTestId('publish-event').click();

		const dialog = page.getByRole('dialog');
		await expect(dialog.locator('button[type="submit"]')).toBeEnabled({ timeout: 15000 });
		await expect(dialog.getByRole('alert')).toHaveCount(0);
		await expect(dialog.locator('textarea:is([name="reason"], [name^="reason/"])')).toHaveCount(0);
	});

	await test.step('a production is opened from the console and offered', async () => {
		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}`);

		// Before: one entry into the console, not two (#976).
		const entry = page.locator(
			`a[href="/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}/production"]`
		);
		await expect(entry).toHaveCount(1, { timeout: 15000 });
		await entry.click();
		await page.waitForURL(/\/production$/);

		const open = page.locator('form[action$="createProduction"] button[type=submit]');
		await expect(open).toBeVisible({ timeout: 15000 });
		await open.click();

		await expect(open).toHaveCount(0, { timeout: 15000 });
		const record = page.getByTestId('production-record');
		await expect(record.locator('input:is([name="producer"], [name^="producer/"])')).toHaveValue(
			'me',
			{ timeout: 15000 }
		);
		await expect
			.poll(() => productionStatusOf(SEED_PRODUCTION_BARE_EVENT_ID), DB_POLL)
			.toBe('draft');

		// The record's card adds a second way into the console.
		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}`);
		await expect(entry).toHaveCount(2, { timeout: 15000 });

		await page.goto(`/staff/events/${SEED_PRODUCTION_BARE_EVENT_ID}/production`);

		// A draft's first move is the offer, rendered first in the record's header.
		const badge = record.locator('.badge').first();
		await expect(badge).toBeVisible({ timeout: 15000 });
		const draftBadge = await badge.textContent();
		await record.getByRole('button').first().click();
		await page.getByRole('dialog').locator('button[type=submit]').click();

		// Written, and surviving a reload: optimistic client state would pass in the page.
		await expect
			.poll(() => productionStatusOf(SEED_PRODUCTION_BARE_EVENT_ID), DB_POLL)
			.toBe('offered');
		await page.reload();
		await expect(badge).toBeVisible({ timeout: 15000 });
		await expect(badge).not.toHaveText(draftBadge ?? '');
	});

	await test.step('a tab is addressable and switching one does not navigate', async () => {
		await page.goto(`/staff/events/${SEED_PRODUCTION_EVENT_ID}/production?tab=advance`);
		await expect(page.getByTestId('volunteer-shifts')).toBeVisible({ timeout: 15000 });

		await page.locator('#tab-overview').click();
		await expect(page).toHaveURL(new RegExp(`/production$`));
		await expect(page.locator('form[action$="setProductionProducer"]')).toBeVisible();
	});

	await test.step('a production reaches its console, whole', async () => {
		await page.goto(`/staff/events/${SEED_SPLIT_CMC_LIVE_ID}`);
		await expect(
			page.locator(`a[href="/staff/events/${SEED_SPLIT_CMC_LIVE_ID}/production"]`)
		).toBeVisible();
		// The room hold is the listing's (#1946), so it is here and not below.
		await expect(page.getByTestId('space-hold')).toBeVisible();

		await page.goto(`/staff/events/${SEED_SPLIT_CMC_LIVE_ID}/production`);
		await expect(page.getByRole('heading', { name: SEED_SPLIT_CMC_LIVE_TITLE })).toBeVisible();
		// No production row is seeded, so the overview offers to open one.
		const overview = page.getByRole('tabpanel');
		await expect(overview).toHaveAttribute('aria-labelledby', 'tab-overview');
		await expect(overview.locator('button[type=submit]')).toBeVisible();
		await expect(page.getByTestId('space-hold')).toHaveCount(0);

		await page.locator('#tab-advance').click();
		await expect(page.getByTestId('volunteer-shifts')).toBeVisible();
	});

	await test.step('a typed console URL on a listing goes back to the general view', async () => {
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}/production`);
		await expect(page).toHaveURL(new RegExp(`/staff/events/${SEED_SPLIT_PENDING_ID}$`));
	});
});
