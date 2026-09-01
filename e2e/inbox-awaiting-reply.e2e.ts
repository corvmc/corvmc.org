import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_AWAITING_THREAD_ID,
	SEED_AWAITING_CONTACT,
	SEED_NEEDS_REPLY_CONTACT
} from './fixtures/seed-inbox-awaiting';

/**
 * The awaiting-reply marker, across the seam no unit test spans: it is written
 * on one layer, read on another, and shown as a view the database never stores.
 * Two rules carry the whole feature and both are asserted here —
 *
 *   - Open holds only what needs a human. A thread we have already answered is
 *     somebody else's move and belongs under Awaiting reply, which is a
 *     separate view rather than a fourth status.
 *   - the nav badge is exactly the Open view. The badge is the one number staff
 *     work from, and a tab beside it reading a different total is the bug this
 *     split fixes.
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
 * One of the five view tabs.
 *
 * Matched on a prefix because the accessible name carries the count badge —
 * "Open 3", not "Open" — and the count is exactly what these tests are trying
 * not to hard-code.
 */
function viewTab(page: Page, label: string) {
	return page.getByRole('tab', { name: new RegExp(`^${label}\\b`) });
}

function row(page: Page, contact: string) {
	// The queue is a list of conversation cards, not a table — see InboxShell.
	return page.getByRole('listitem').filter({ hasText: contact });
}

test.describe('inbox awaiting reply', () => {
	test('Open holds what needs a reply and nothing else', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inbox');

		// Both threads are `status = 'open'`; only one of them is work.
		await expect(row(page, SEED_NEEDS_REPLY_CONTACT)).toBeVisible();
		await expect(row(page, SEED_AWAITING_CONTACT)).toHaveCount(0);

		// The Open row says *why* it is there — nobody here has ever answered it.
		await expect(row(page, SEED_NEEDS_REPLY_CONTACT)).toContainText('Unanswered');
	});

	test('the awaiting view holds the other half, and survives a round trip', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inbox');

		await viewTab(page, 'Awaiting reply').click();
		await expect(row(page, SEED_AWAITING_CONTACT)).toBeVisible();
		await expect(row(page, SEED_NEEDS_REPLY_CONTACT)).toHaveCount(0);

		// Mirrored into the URL, so opening a thread and coming back holds it.
		await expect(page).toHaveURL(/view=awaiting/);

		// And a reload lands on the same view rather than back on Open.
		await page.reload();
		await expect(row(page, SEED_AWAITING_CONTACT)).toBeVisible();
	});

	// The claim the split exists to make: the number on the nav item and the
	// number on the Open tab are the same set counted twice.
	test('the nav badge and the Open tab agree', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inbox');

		await expect(viewTab(page, 'Open')).toBeVisible();
		const badge = await navBadgeCount(page);
		const tab = Number((await viewTab(page, 'Open').innerText()).replace(/\D+/g, ''));

		expect(tab).toBe(badge);
	});

	test('clearing the marker returns the thread to Open and to the badge', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inbox/${SEED_AWAITING_THREAD_ID}`);

		// The pair of buttons is the marker's state: only one is offered at a time.
		await expect(page.getByRole('button', { name: 'Needs a reply' })).toBeVisible();
		const before = await navBadgeCount(page);

		await page.getByRole('button', { name: 'Needs a reply' }).click();

		// The thread is back in the queue, and the badge counts it again.
		await expect(page.getByRole('button', { name: 'Needs a reply' })).toHaveCount(0);
		await expect
			.poll(() => navBadgeCount(page), { timeout: 10000, message: 'nav badge' })
			.toBe(before + 1);

		// And back again, which is the manual half of the marker.
		await page.getByRole('button', { name: 'Awaiting reply' }).click();
		await expect(page.getByRole('button', { name: 'Needs a reply' })).toBeVisible();
		await expect
			.poll(() => navBadgeCount(page), { timeout: 10000, message: 'nav badge' })
			.toBe(before);
	});
});
