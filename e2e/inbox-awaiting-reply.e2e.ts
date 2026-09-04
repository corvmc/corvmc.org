import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_AWAITING_THREAD_ID,
	SEED_AWAITING_CONTACT,
	SEED_NEEDS_REPLY_THREAD_ID,
	SEED_NEEDS_REPLY_CONTACT,
	SEED_SNOOZED_CONTACT,
	SEED_META_STALE_THREAD_ID,
	SEED_META_STALE_CONTACT
} from './fixtures/seed-inbox-awaiting';

/**
 * The awaiting-reply marker, across the seam no unit test spans: it is written
 * on one layer, read on another, and shown as a view the database never stores.
 * Two rules carry the whole feature and both are asserted here —
 *
 *   - Open holds only what needs a human. A thread we have already answered is
 *     somebody else's move and belongs under Snoozed, parked beside the threads
 *     waiting on a date — one view, because both come back on their own, and
 *     neither is a fourth status.
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
 * One of the four view tabs.
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

	test('Snoozed holds the parked half, and survives a round trip', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inbox');

		await viewTab(page, 'Snoozed').click();
		await expect(row(page, SEED_AWAITING_CONTACT)).toBeVisible();
		await expect(row(page, SEED_SNOOZED_CONTACT)).toBeVisible();
		await expect(row(page, SEED_NEEDS_REPLY_CONTACT)).toHaveCount(0);

		// One view, two reasons to be in it — and the merge's whole premise is
		// that a row still says which of the two it is.
		await expect(row(page, SEED_AWAITING_CONTACT)).toContainText('Awaiting reply');
		await expect(row(page, SEED_SNOOZED_CONTACT)).toContainText('Snoozed');

		// Mirrored into the URL, so opening a thread and coming back holds it.
		await expect(page).toHaveURL(/view=snoozed/);

		// And a reload lands on the same view rather than back on Open.
		await page.reload();
		await expect(row(page, SEED_AWAITING_CONTACT)).toBeVisible();
	});

	// The tab Snoozed absorbed. Old bookmarks and saved-view rows still say
	// `awaiting` and nothing rewrites them, so falling back to Open would land
	// somebody in a different queue from the one they saved.
	test('an old ?view=awaiting URL lands on Snoozed', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inbox?view=awaiting');

		await expect(row(page, SEED_AWAITING_CONTACT)).toBeVisible();
		await expect(page).toHaveURL(/view=snoozed/);
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

	// The marker's two manual directions, and the round trip that proves they are
	// each other's inverse. Both go through the DispositionBar: clearing it is
	// the reopen slot ("Needs a reply"), setting it is the snooze menu's
	// conditional option ("When they reply") — the same state the default send
	// applies, reached deliberately.
	test('clearing the marker returns the thread to Open and to the badge', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inbox/${SEED_AWAITING_THREAD_ID}`);

		await expect(page.getByRole('button', { name: 'Needs a reply' })).toBeVisible();
		const before = await navBadgeCount(page);

		await page.getByRole('button', { name: 'Needs a reply' }).click();

		// The thread is back in the queue, and the badge counts it again.
		await expect(page.getByRole('button', { name: 'Needs a reply' })).toHaveCount(0);
		await expect
			.poll(() => navBadgeCount(page), { timeout: 10000, message: 'nav badge' })
			.toBe(before + 1);

		// And back again, from the snooze menu.
		await page.getByRole('button', { name: /^Snooze/ }).click();
		await page.getByRole('menuitem', { name: 'When they reply' }).click();

		await expect(page.getByRole('button', { name: 'Needs a reply' })).toBeVisible();
		await expect
			.poll(() => navBadgeCount(page), { timeout: 10000, message: 'nav badge' })
			.toBe(before);
	});

	// Every disposition is reversible for ten seconds, and the toast is the only
	// place that offer appears. A disposition that lands with no way back is the
	// bug this whole surface is built around not having.
	test('a disposition offers an undo that puts the thread back', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inbox/${SEED_NEEDS_REPLY_THREAD_ID}`);

		await page.getByRole('button', { name: /^Resolve/ }).click();
		await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();

		await page.getByRole('button', { name: 'Undo' }).click();

		// Back to open: the reopen slot is gone and the four exits are offered
		// again.
		await expect(page.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Resolve/ })).toBeVisible();
	});
});

/**
 * Meta's reply window, which is the one composer state that cannot be reached
 * by clicking: it turns on the *age* of the newest inbound message, decided
 * page-side from the thread's own rows, and no unit test spans that seam.
 *
 * Instagram and Messenger refuse a message sent more than seven days after the
 * contact last wrote. Left unhandled, a staffer finds that out by typing a
 * reply, pressing send, and watching a Graph error come back — which is exactly
 * the failure the block exists to move earlier.
 */
test.describe('Meta reply window', () => {
	test('a thread past the window offers a note instead of a reply', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inbox/${SEED_META_STALE_THREAD_ID}`);

		// The thread itself renders — this is a block on replying, not on reading.
		await expect(page.getByText(SEED_META_STALE_CONTACT).first()).toBeVisible();

		await expect(page.getByText(/window has closed/i)).toBeVisible();

		// The composer falls back to a note: staff-only, and never dispatched.
		await expect(page.getByText('Staff only — the contact never sees this')).toBeVisible();
		await expect(page.getByPlaceholder('Add an internal note…')).toBeVisible();
		await expect(page.getByPlaceholder('Type your reply…')).toHaveCount(0);
	});

	// The same page, on a thread inside the window, must still offer a reply —
	// otherwise a block that fired on every Meta thread would pass the test above
	// and take the channel out of service.
	test('a thread inside the window still offers a reply', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inbox/${SEED_NEEDS_REPLY_THREAD_ID}`);

		await expect(page.getByPlaceholder('Type your reply…')).toBeVisible();
		await expect(page.getByText(/window has closed/i)).toHaveCount(0);
	});
});
