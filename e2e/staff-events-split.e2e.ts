import { test, expect } from './fixtures/auth';
import {
	SEED_SPLIT_CMC_DRAFT_TITLE,
	SEED_SPLIT_CMC_LIVE_ID,
	SEED_SPLIT_CMC_LIVE_TITLE,
	SEED_SPLIT_PENDING_ID,
	SEED_SPLIT_PENDING_TITLE,
	SEED_SPLIT_LIVE_TITLE,
	SEED_SPLIT_DRAFT_TITLE,
	SEED_SPLIT_NEAR_ID,
	SEED_SPLIT_FAR_ID,
	SEED_SPLIT_MEMBER_NAME
} from './fixtures/seed-events-split';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * The staff events split, after the URL reversal.
 *
 * `/staff/events` is the calendar and the general event view — the address
 * every event ref resolves to, so it is where a staffer lands by default from
 * anywhere in the panel. Productions (`/staff/productions`) and a show's Production
 * tab (`/staff/events/[id]?tab=production`) are the CMC work surfaces.
 *
 * What is worth a round trip: neither index is a subset of the other, the
 * general view carries no production controls, a listing has no Production tab,
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

		// A listing waiting on staff sits in date order, not pinned above the
		// dates: the CMC draft starts two days before it.
		await expect
			.poll(() =>
				page.getByRole('row').evaluateAll(
					(rows, { first, second }) => {
						const at = (t: string) => rows.findIndex((r) => r.textContent?.includes(t));
						return at(first) >= 0 && at(first) < at(second);
					},
					{ first: SEED_SPLIT_CMC_DRAFT_TITLE, second: SEED_SPLIT_PENDING_TITLE }
				)
			)
			.toBe(true);

		// The status filter narrows the list and goes into the address.
		await page.getByTestId('status-filter').selectOption('pending_review');
		await expect(page).toHaveURL(/[?&]status=pending_review/);
		await expect(pending).toBeVisible();
		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toHaveCount(0);
	});

	// Productions holds production records, not listings (#3112). The old view's
	// address lands there.
	test('Productions holds productions and no listings', async ({ page }) => {
		await page.goto('/staff/events?view=productions');
		// The redirect adds `via`, and the page drops it once it hydrates (#3167).
		await expect(page).toHaveURL(/\/staff\/productions(?:[?#]|$)/);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

		await expect(page.getByText(SEED_SPLIT_CMC_DRAFT_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_PENDING_TITLE)).toHaveCount(0);
		await expect(page.getByText(SEED_SPLIT_LIVE_TITLE)).toHaveCount(0);
	});

	test('the general view carries facts, no production controls, and a two-hour window', async ({
		page
	}) => {
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}`);
		await expect(page.getByRole('heading', { name: SEED_SPLIT_PENDING_TITLE })).toBeVisible();

		// Who is accountable, said once, in the posted-by line.
		await expect(
			page.getByRole('main').getByRole('link', { name: SEED_SPLIT_MEMBER_NAME })
		).toHaveCount(1);

		// Production controls belong to a CMC show's Production tab.
		await expect(page.getByTestId('space-hold')).toHaveCount(0);
		await expect(page.getByRole('main').locator('a[href*="tab=production"]')).toHaveCount(0);

		// The window is two hours, not the day: the Approve dialog warns of a
		// possible duplicate in the slot and not of the later show (#3270).
		await page.getByTestId('approve-listing').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.locator(`a[href="/staff/events/${SEED_SPLIT_NEAR_ID}"]`)).toBeVisible();
		await expect(dialog.locator(`a[href="/staff/events/${SEED_SPLIT_FAR_ID}"]`)).toHaveCount(0);
	});

	test('a production has a Production tab, and a listing is turned away', async ({ page }) => {
		await page.goto(`/staff/events/${SEED_SPLIT_CMC_LIVE_ID}`);
		const tab = page
			.getByRole('main')
			.locator(`a[href="/staff/events/${SEED_SPLIT_CMC_LIVE_ID}?tab=production"]`)
			.first();
		await expect(tab).toBeVisible();
		// The room hold is the listing's (#1946), so it is on the Listing tab, under
		// Where. No reservation is seeded for this show and it names no place, so the
		// room is chosen and the hold reads as not held (#3271).
		await expect(page.getByTestId('space-hold')).toBeVisible();

		await tab.click();
		await expect(page.getByRole('heading', { name: SEED_SPLIT_CMC_LIVE_TITLE })).toBeVisible();
		// No production row is seeded, so the tab offers to open one.
		await expect(
			page.locator('form[action$="createProduction"] button[type=submit]').first()
		).toBeVisible();
		await expect(page.getByTestId('space-hold')).toHaveCount(0);
		// The staffing is on the same tab, with no inner tabs to find it behind.
		await expect(page.getByTestId('related-add-shift')).toBeVisible();

		// A listing has no Production tab, so its old console URL lands on Listing.
		await page.goto(`/staff/events/${SEED_SPLIT_PENDING_ID}/production`);
		await expect(page).toHaveURL(new RegExp(`/staff/events/${SEED_SPLIT_PENDING_ID}(\\?.*)?$`));
		await expect(page.getByTestId('space-hold')).toHaveCount(0);
		await expect(page.getByTestId('listing-form')).toBeVisible();
	});
});
