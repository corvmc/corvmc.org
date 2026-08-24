import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_AWAITING_THREAD_ID,
	SEED_AWAITING_CONTACT,
	SEED_NEEDS_REPLY_CONTACT
} from './fixtures/seed-inbox-awaiting';

/**
 * The awaiting-reply marker, across the seam no unit test spans: it is written
 * on one layer, read on another, and shown as a status the database never
 * stores. Two rules carry the whole feature and both are asserted here —
 *
 *   - an awaiting thread stays in the Open queue. If it ever starts behaving
 *     like a fourth status, the Open tab quietly loses conversations that are
 *     still live.
 *   - it drops out of the nav badge anyway. That is what makes the badge mean
 *     "waiting on us", and it is the one number staff actually work from.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/** The Inbox count in the staff sidebar; absent entirely when it is zero. */
async function navBadgeCount(page: Page): Promise<number> {
	const badge = page.locator('a[href="/staff/inbox"] .badge');
	if ((await badge.count()) === 0) return 0;
	return Number((await badge.first().innerText()).trim());
}

/**
 * Reveal the filter controls.
 *
 * The queue is a ~24rem list pane now, and `FilterBar` collapses everything but
 * search behind a disclosure below its `@lg` container width — search plus three
 * selects does not fit beside an open conversation.
 */
async function openFilters(page: Page) {
	// A <label> driving a peer checkbox, not a button — FilterBar uses that
	// because <details> cannot be forced open by CSS at wide widths.
	await page.locator('label').filter({ hasText: 'Filters' }).first().click();
}

function row(page: Page, contact: string) {
	// The queue is a list of conversation cards, not a table — see InboxShell.
	return page.getByRole('listitem').filter({ hasText: contact });
}

test.describe('inbox awaiting reply', () => {
	test('an awaiting thread stays in Open, badged apart from the rest', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inbox');

		// The default view is Open, and both seeded threads are open.
		await expect(row(page, SEED_AWAITING_CONTACT)).toContainText('Awaiting reply');
		await expect(row(page, SEED_NEEDS_REPLY_CONTACT)).toContainText('Open');
	});

	test('the waiting-on filter splits the two, and survives a round trip', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inbox');
		await openFilters(page);

		await page.getByLabel('Waiting on').selectOption('yes');
		await expect(row(page, SEED_AWAITING_CONTACT)).toBeVisible();
		await expect(row(page, SEED_NEEDS_REPLY_CONTACT)).toHaveCount(0);

		// Mirrored into the URL, so opening a thread and coming back holds it.
		await expect(page).toHaveURL(/waiting=yes/);

		await page.getByLabel('Waiting on').selectOption('no');
		await expect(row(page, SEED_NEEDS_REPLY_CONTACT)).toBeVisible();
		await expect(row(page, SEED_AWAITING_CONTACT)).toHaveCount(0);
	});

	test('clearing the marker returns the thread to the nav badge', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inbox/${SEED_AWAITING_THREAD_ID}`);

		await expect(page.getByText(/Waiting on a reply since/)).toBeVisible();
		const before = await navBadgeCount(page);

		await page.getByRole('button', { name: 'Needs a reply' }).click();

		// The thread is back in the queue, and the badge counts it again.
		await expect(page.getByText(/Waiting on a reply since/)).toHaveCount(0);
		await expect
			.poll(() => navBadgeCount(page), { timeout: 10000, message: 'nav badge' })
			.toBe(before + 1);

		// And back again, which is the manual half of the marker.
		await page.getByRole('button', { name: 'Awaiting reply' }).click();
		await expect(page.getByText(/Waiting on a reply since/)).toBeVisible();
		await expect
			.poll(() => navBadgeCount(page), { timeout: 10000, message: 'nav badge' })
			.toBe(before);
	});
});
