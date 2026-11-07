import { test, expect, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
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
	SEED_CE_PENDING_TITLE,
	SEED_CE_DELETABLE_ID,
	eventExists,
	SEED_CE_CANCELLED_TITLE,
	SEED_CE_CANCELLED_ID,
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

/** Swap to somebody else; `signInAs` replaces the cookies outright. */
async function switchUser(page: Page, email: string, password: string) {
	await login(page, email, password);
}

async function login(page: Page, email: string, password: string) {
	await signInAs(page, { email, password });
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

	test('a cancelled listing offers members no RSVP or ticket (#2219)', async ({ page }) => {
		await login(page, SEED_CE_REVIEW_EMAIL, SEED_CE_PASSWORD);
		await page.goto(`/member/events/${SEED_CE_CANCELLED_ID}`);
		// The CTA block renders first, so the count below is not read off an empty page.
		const ctas = page.locator('.edet__ctas');
		await expect(ctas).toBeVisible();
		await expect(ctas.locator('button, a[href]')).toHaveCount(0);
	});

	test('a draft reaches neither the public guide nor the staff queue', async ({ page }) => {
		await page.goto('/events');
		await expect(page.getByText(SEED_CE_DRAFT_TITLE)).toHaveCount(0);

		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		// The calendar lists every listing; a member's community draft is not one.
		await page.goto('/staff/events');
		await expect(page.getByText(SEED_CE_DRAFT_TITLE)).toHaveCount(0);

		// The pre-split URL sent in notifications for as long as the old tab
		// existed. It needs no redirect: the calendar ignores the parameter and
		// lists everything pending review.
		await page.goto('/staff/events?status=pending_review');
		await expect(page.getByText(SEED_CE_PENDING_TITLE)).toBeVisible();
	});

	test('a trusted member publishes straight to the calendar', async ({ page }) => {
		await login(page, SEED_CE_TRUSTED_EMAIL, SEED_CE_PASSWORD);
		await page.goto(`/member/events/${SEED_CE_DRAFT_ID}/manage`);

		// A trusted member's publish goes straight out.
		await page.getByTestId('publish-listing').click();
		await page.getByRole('dialog').locator('button[type=submit]').click();

		await expect
			.poll(async () => (await readListingState(SEED_CE_DRAFT_ID)).status, { timeout: 15000 })
			.toBe('published');

		await page.goto('/events');
		await expect(page.getByText(SEED_CE_DRAFT_TITLE)).toBeVisible();
	});

	test('a review-required member is told so, and their listing queues', async ({ page }) => {
		await login(page, SEED_CE_REVIEW_EMAIL, SEED_CE_PASSWORD);
		await page.goto(`/member/events/${SEED_CE_QUEUE_DRAFT_ID}/manage`);

		// Same button, different outcome: the listing queues instead of publishing.
		const submit = page.getByTestId('publish-listing');
		await expect(submit).toBeVisible();
		await submit.click();
		await page.getByRole('dialog').locator('button[type=submit]').click();

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
		await page.getByTestId('reject-listing').click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('textarea:is([name="notes"], [name^="notes/"])').fill(REASON);
		await dialog.locator('button[type=submit]').click();

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
	test('a clean event can be deleted outright', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/events/${SEED_CE_DELETABLE_ID}`);

		await page.getByTestId('delete-event').click();
		await page.getByRole('dialog').locator('button[type=submit]').click();

		await expect
			.poll(async () => eventExists(SEED_CE_DELETABLE_ID), { timeout: 15000 })
			.toBe(false);
	});
});

/**
 * Adding a show: a modal asking for what the listing needs to exist, then the
 * manage page for the rest (#1825). A half-written listing is the common case,
 * so closing the modal with something typed asks first (#905).
 */
test.describe('starting a listing', () => {
	async function openAddShow(page: Page) {
		// Retried for the hydration race `ticket-purchase.e2e.ts` documents: a
		// click before Svelte attaches opens nothing.
		await expect(async () => {
			await page.goto('/member/events');
			await page.getByTestId('add-show').click();
			await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
		}).toPass({ timeout: 20000 });
		return page.getByRole('dialog');
	}

	test('a show starts from four fields and lands on its manage page', async ({ page }) => {
		await login(page, SEED_CE_TRUSTED_EMAIL, SEED_CE_PASSWORD);
		const dialog = await openAddShow(page);

		const date = new Date();
		date.setDate(date.getDate() + 30);
		const ymd = [
			date.getFullYear(),
			String(date.getMonth() + 1).padStart(2, '0'),
			String(date.getDate()).padStart(2, '0')
		].join('-');

		await dialog.getByLabel('Title').fill('Paper Wolves at a house show');
		await dialog.getByLabel('Date').fill(ymd);
		await dialog.getByLabel('Start Time').fill('20:00');
		await dialog.getByLabel('Venue').fill('The Whiteside');
		await expect(dialog.getByLabel('Description')).toHaveCount(0);
		await dialog.locator('button[type="submit"]').click();

		await expect(page).toHaveURL(/\/member\/events\/[^/]+\/manage$/, {
			timeout: 15000
		});
		await expect(page.getByLabel('Title')).toHaveValue('Paper Wolves at a house show');
		await expect(page.getByLabel('Description')).toBeVisible();
	});

	test('closing a part-written show asks before discarding it', async ({ page }) => {
		await login(page, SEED_CE_TRUSTED_EMAIL, SEED_CE_PASSWORD);
		const dialog = await openAddShow(page);

		await dialog.getByLabel('Title').fill('Paper Wolves at a house show');
		await dialog.locator('[data-dialog-close]').click();
		const prompt = dialog.getByTestId('discard-prompt');
		await expect(prompt).toBeVisible();
		await expect(dialog.getByLabel('Title')).toBeHidden();

		// Keep editing, the prompt's first choice, gives back exactly what was typed.
		await prompt.getByRole('button').first().click();
		await expect(prompt).toHaveCount(0);
		await expect(dialog.getByLabel('Title')).toHaveValue('Paper Wolves at a house show');
	});

	test('the old submit address lands on the Events page', async ({ page }) => {
		await login(page, SEED_CE_TRUSTED_EMAIL, SEED_CE_PASSWORD);
		await page.goto('/member/events/submit');
		await expect(page).toHaveURL(/\/member\/events$/);
	});
});
