import { test, expect } from './fixtures/auth';
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
 * anywhere in the panel. `/staff/projects/productions` and `/staff/events/[id]/production`
 * are the CMC work surfaces, sitting on their own paths so they can be gated
 * later without making every inbound link conditional.
 *
 * What is worth a round trip: neither index is a subset of the other, the
 * general view carries no production controls, the console refuses a listing,
 * and the two-hour window really is a window rather than a day.
 */

test.use({ persona: { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD } });

test.describe('staff events split', () => {
	// It shipped at /staff/calendar for a few hours, and the notification rows
	// written in that window keep that href forever.
	test('the calendar holds /staff/events, its old address, and every listing', async ({ page }) => {
		await page.goto('/staff/calendar');
		await expect(page).toHaveURL(/\/staff\/events$/);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

		// The lister owns several seeded listings, so their link is on more than one row.
		const pending = page.getByRole('row').filter({ hasText: SEED_SPLIT_PENDING_TITLE });
		await expect(pending).toBeVisible();
		await expect(pending.getByRole('link', { name: SEED_SPLIT_MEMBER_NAME })).toBeVisible();

		// Every listing is on the calendar, drafts included, bar a member's own
		// community draft.
		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_DRAFT_TITLE)).toHaveCount(0);

		// Listings waiting on staff are pinned above the dates, under their own
		// group: the first group row, before the second.
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

	test('Productions holds CMC work, including drafts, and no listings', async ({ page }) => {
		await page.goto('/staff/projects/productions');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_LIVE_TITLE)).toHaveCount(0);
	});

	test('the general view carries facts, no production controls, and a two-hour window', async ({
		page
	}) => {
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}`);
		await expect(page.getByRole('heading', { name: SEED_SPLIT_PENDING_TITLE })).toBeVisible();

		// Who is accountable, said once: the second card repeating the lister is gone.
		await expect(
			page.getByRole('main').getByRole('link', { name: SEED_SPLIT_MEMBER_NAME })
		).toHaveCount(1);

		// Production controls belong to the console. Scoped to the cards, because
		// the sidebar's own Space and Volunteering sections are on every page.
		await expect(page.getByTestId('space-hold')).toHaveCount(0);
		await expect(page.getByTestId('volunteer-shifts')).toHaveCount(0);
		await expect(
			page.locator(`a[href="/staff/events/${SEED_SPLIT_PENDING_ID}/production"]`)
		).toHaveCount(0);

		// The window is two hours, not the day. Both are on the same date. Only a
		// real window tells them apart, which is the whole reason this is not a
		// day query.
		await expect(page.getByRole('row').filter({ hasText: SEED_SPLIT_NEAR_TITLE })).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_FAR_TITLE)).toHaveCount(0);
	});

	test('a production reaches its console, and a listing is turned away', async ({ page }) => {
		await page.goto(`/staff/events/${SEED_SPLIT_CMC_LIVE_ID}`);
		// The one entry into the console (#976).
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
		// The header's way back, not the breadcrumb that shares its href.
		await expect(
			page.getByRole('main').locator(`a[href="/staff/events/${SEED_SPLIT_CMC_LIVE_ID}"]:not(nav a)`)
		).toBeVisible();

		// The console is tabbed now, and the staffing lives on Advance. Reached by
		// the tab rather than by `?tab=`, because what this asserts is that the
		// console is whole — every part of it still reachable from where you land.
		await page.locator('#tab-advance').click();
		await expect(page.getByTestId('volunteer-shifts')).toBeVisible();

		// The console has nothing to say about a listing, so a hand-typed URL goes
		// back to the view that does.
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}/production`);
		await expect(page).toHaveURL(new RegExp(`/staff/events/${SEED_SPLIT_PENDING_ID}$`));
	});
});
