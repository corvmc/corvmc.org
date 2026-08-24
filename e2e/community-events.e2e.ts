import { test, expect, type Page } from '@playwright/test';
import {
	SEED_CE_PASSWORD,
	SEED_CE_TRUSTED_EMAIL,
	SEED_CE_REVIEW_EMAIL,
	SEED_CE_DRAFT_ID,
	SEED_CE_DRAFT_TITLE,
	SEED_CE_PUBLISHED_TITLE,
	SEED_CE_QUEUE_DRAFT_ID,
	SEED_CE_QUEUE_DRAFT_TITLE,
	SEED_CE_PENDING_ID,
	SEED_CE_DELETABLE_ID,
	SEED_CE_TICKETED_ID,
	eventExists,
	SEED_CE_CANCELLED_TITLE,
	readListingState
} from './fixtures/seed-community-events';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Community listings, end to end.
 *
 * The three things unit tests cannot prove, in order of how much they'd cost to
 * get wrong:
 *
 *   1. A draft is invisible to everyone but its author. Two separate negatives
 *      — absent from the public guide AND absent from the staff review queue —
 *      that only a round trip can assert together.
 *   2. Publishing routes by standing: straight to the guide for a trusted
 *      member, into the queue for a review-required one.
 *   3. A rejection reaches the member as written English with the reason
 *      attached, and their fix gets back to staff.
 */

/**
 * Log in as somebody else. `/login` bounces an already-authenticated user, so
 * the session has to go first — otherwise the "second login" quietly no-ops and
 * the rest of the test runs as the wrong account.
 */
async function switchUser(page: Page, email: string, password: string) {
	await page.context().clearCookies();
	await login(page, email, password);
}

async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('community listings', () => {
	test('a published listing is on the public gig guide', async ({ page }) => {
		await page.goto('/events');
		await expect(page.getByText(SEED_CE_PUBLISHED_TITLE)).toBeVisible();
	});

	test('a cancelled listing stays on the guide, marked', async ({ page }) => {
		// The cancellation IS the announcement — the people who need it are the
		// ones who already had the date, so it must not silently vanish.
		await page.goto('/events');
		const row = page.locator('li.gig-row', { hasText: SEED_CE_CANCELLED_TITLE });
		await expect(row).toBeVisible();
		// The badge specifically, not any text reading "Cancelled" — a title
		// containing the word would satisfy a looser locator and prove nothing.
		await expect(row.locator('.gig-row__cancelled-tag')).toBeVisible();
	});

	test('a draft reaches neither the public guide nor the staff queue', async ({ page }) => {
		await page.goto('/events');
		await expect(page.getByText(SEED_CE_DRAFT_TITLE)).toHaveCount(0);

		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		// Straight to the queue by URL, the way the staff notification links —
		// if the tab didn't read the URL this would silently assert the All tab.
		await page.goto('/staff/events?status=pending_review');
		// TabBar's client-state mode is a real tablist, so its items are role=tab.
		// They were role=radio, from a bits-ui ToggleGroup.
		await expect(page.getByRole('tab', { name: /Needs review/ })).toHaveClass(/latched/);
		await expect(page.getByText(SEED_CE_DRAFT_TITLE)).toHaveCount(0);
	});

	test('a trusted member publishes straight to the calendar', async ({ page }) => {
		await login(page, SEED_CE_TRUSTED_EMAIL, SEED_CE_PASSWORD);
		await page.goto(`/member/events/${SEED_CE_DRAFT_ID}/manage`);

		// The label is the promise: a trusted member is told "Publish", not
		// "Submit for review".
		await page.getByRole('button', { name: 'Publish', exact: true }).click();
		await page.getByRole('button', { name: 'Publish', exact: true }).last().click();

		await expect
			.poll(async () => (await readListingState(SEED_CE_DRAFT_ID)).status, { timeout: 15000 })
			.toBe('published');

		await page.goto('/events');
		await expect(page.getByText(SEED_CE_DRAFT_TITLE)).toBeVisible();
	});

	test('a review-required member is told so, and their listing queues', async ({ page }) => {
		await login(page, SEED_CE_REVIEW_EMAIL, SEED_CE_PASSWORD);
		await page.goto(`/member/events/${SEED_CE_QUEUE_DRAFT_ID}/manage`);

		// Same button, different promise — and it has to say the different thing.
		const submit = page.getByRole('button', { name: 'Submit for review' });
		await expect(submit).toBeVisible();
		await submit.click();
		await page.getByRole('button', { name: 'Submit for review' }).last().click();

		await expect
			.poll(async () => (await readListingState(SEED_CE_QUEUE_DRAFT_ID)).status, {
				timeout: 15000
			})
			.toBe('pending_review');

		await page.goto('/events');
		await expect(page.getByText(SEED_CE_QUEUE_DRAFT_TITLE)).toHaveCount(0);
	});

	test('staff turn a listing down with a reason, and the member sees it', async ({ page }) => {
		// Uses its own already-queued row rather than the one the test above
		// submits: a test that only passes when its predecessor ran is a test that
		// will one day pass for the wrong reason.
		const REASON = 'E2E: we need a real venue and a contact before this goes up.';

		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/events/${SEED_CE_PENDING_ID}`);
		await page.getByRole('button', { name: 'Turn down' }).click();
		await page.locator('textarea[name="notes"]').fill(REASON);
		await page
			.getByRole('button', { name: /Turn down|Submit|Confirm/ })
			.last()
			.click();

		await expect
			.poll(async () => (await readListingState(SEED_CE_PENDING_ID)).status, { timeout: 15000 })
			.toBe('rejected');
		expect((await readListingState(SEED_CE_PENDING_ID)).reviewNotes).toBe(REASON);

		// The reason is the point of a rejection: a member who can't see what was
		// wrong can't fix it. It has to arrive as written English, not Zod text.
		await switchUser(page, SEED_CE_REVIEW_EMAIL, SEED_CE_PASSWORD);
		await page.goto(`/member/events/${SEED_CE_PENDING_ID}/manage`);
		await expect(page.getByText(REASON)).toBeVisible();
	});
});

/**
 * Deleting an event.
 *
 * Cancelling used to double as "make this go away". Now that a cancelled show
 * stays on the guide, staff needed a way to remove a row that should never have
 * existed — and the one thing that control must never do is take a ticketed
 * event's payment records with it.
 */
test.describe('deleting an event', () => {
	test('a ticketed event cannot be deleted, and says why', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/events/${SEED_CE_TICKETED_ID}`);

		const del = page.getByRole('button', { name: 'Delete' });
		await expect(del).toBeDisabled();
		// The reason has to be reachable, not just implied by a dead button.
		await expect(del).toHaveAttribute('title', /cancel it instead/i);

		expect(await eventExists(SEED_CE_TICKETED_ID)).toBe(true);
	});

	test('a clean event can be deleted outright', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/events/${SEED_CE_DELETABLE_ID}`);

		await page.getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete permanently' }).click();

		await expect
			.poll(async () => eventExists(SEED_CE_DELETABLE_ID), { timeout: 15000 })
			.toBe(false);
	});
});
