import { test, expect, type Page } from '@playwright/test';
import {
	SEED_SG_PASSWORD,
	SEED_SG_AUTHOR_ID,
	SEED_SG_AUTHOR_EMAIL,
	SEED_SG_REPORTER_EMAIL,
	SEED_SG_BYSTANDER_EMAIL,
	SEED_SG_DISMISS_ID,
	SEED_SG_DISMISS_TITLE,
	SEED_SG_UPHOLD_ID,
	SEED_SG_UPHOLD_TITLE,
	SEED_SG_VISIBLE_ID,
	SEED_SG_VISIBLE_TITLE,
	SEED_SG_UNVOTED_ID,
	SEED_SG_EDIT_ID,
	SEED_SG_EDIT_PROPOSED_TITLE,
	SEED_SG_MERGE_TARGET_ID,
	SEED_SG_MERGE_SOURCE_ID,
	SEED_SG_MERGE_SOURCE_TITLE,
	SEED_SG_MERGE_UNION_VOTES,
	readSuggestionState,
	readSuggestionStanding,
	readSuggestionText
} from './fixtures/seed-suggestions';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * The suggestion board, end to end.
 *
 * What only a round trip can prove, in order of how much it would cost to get
 * wrong:
 *
 *   1. Dismissing a report RESTORES the suggestion. This is the deliberate
 *      asymmetry with event listings — because a report already hid the post,
 *      "dismiss does nothing" would hand every member a permanent takedown
 *      button. Highest-consequence bug in the feature.
 *   2. A report hides the post from EVERYONE except its author. Three separate
 *      facts (gone for the reporter, gone for a bystander, still reachable by
 *      its author) that no unit test can assert together.
 *   3. Upholding reaches forward in time: the author's NEXT suggestion is
 *      withheld, and approving it releases it onto the board.
 *   4. A merged pair's vote count is the union of both voter sets, read back
 *      through the real board query rather than a mocked select.
 */

/**
 * Poll options for reading state back out of D1.
 *
 * Read-backs go through `readLocalDb`, which opens the D1 file directly rather
 * than starting a second workerd over it — the earlier `getPlatformProxy()` per
 * call, at Playwright's default intervals (100/250/500/1000ms, a dozen of them
 * per 15s poll), was enough to push the *next* suite's server into
 * `SQLITE_BUSY` on CI. Check quickly once, then back off hard anyway — the
 * writes being waited on land in well under a second, so this costs no wall
 * clock.
 */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, DB_POLL);
}

/**
 * Log in as somebody else. `/login` bounces an already-authenticated user, so
 * the session has to go first — otherwise the "second login" quietly no-ops and
 * the rest of the test runs as the wrong account.
 */
async function switchUser(page: Page, email: string, password: string) {
	await page.context().clearCookies();
	await login(page, email, password);
}

/** File a report against a suggestion from its member-facing detail page. */
async function reportSuggestion(page: Page, suggestionId: string, reason: string) {
	await page.goto(`/member/suggestions/${suggestionId}`);
	await page.getByRole('button', { name: 'Flag for review' }).click();
	await page.locator('input[name="reason"]').fill(reason);
	await page.getByRole('button', { name: 'Send report' }).click();
}

/** Resolve or dismiss the newest pending report from the staff flag queue. */
async function decideReport(page: Page, entityTitle: string, decision: 'resolved' | 'dismissed') {
	await page.goto('/staff/flags');
	await page.getByRole('link', { name: entityTitle }).first().click();
	await page.waitForURL(/\/staff\/flags\/[^/]+$/);
	await page.getByRole('button', { name: 'Resolve / Dismiss' }).click();
	await page.locator('select[name="resolution"]').selectOption(decision);
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
}

test.describe('suggestion board', () => {
	test('a member sees the board with its seeded suggestions', async ({ page }) => {
		await login(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');

		await expect(page.getByRole('link', { name: SEED_SG_VISIBLE_TITLE })).toBeVisible();
		// No feature flag gates this, so the nav item is simply there.
		await expect(page.getByRole('link', { name: 'Suggestions' }).first()).toBeVisible();
	});

	test('voting is a toggle, and never counts the same member twice', async ({ page }) => {
		await login(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto(`/member/suggestions/${SEED_SG_DISMISS_ID}`);

		const before = (await readSuggestionState(SEED_SG_DISMISS_ID)).voteCount;

		await page.getByRole('button', { name: /^\d+$/ }).first().click();
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_DISMISS_ID)).voteCount, DB_POLL)
			.toBe(before + 1);

		// Clicking again removes it rather than adding a second.
		await page.getByRole('button', { name: /^\d+$/ }).first().click();
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_DISMISS_ID)).voteCount, DB_POLL)
			.toBe(before);
	});

	test('a merged suggestion carries the union of both voter sets, not the sum', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/suggestions/${SEED_SG_MERGE_SOURCE_ID}`);

		await page.getByRole('button', { name: 'Merge into another' }).click();
		await page.locator('select[name="targetId"]').selectOption(SEED_SG_MERGE_TARGET_ID);
		await page.getByRole('button', { name: 'Merge', exact: true }).click();

		// 3 voters on the target + 2 on the source, one of whom voted for both.
		// A correct merge lands on 4; double-counting lands on 5.
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_MERGE_TARGET_ID)).voteCount, DB_POLL)
			.toBe(SEED_SG_MERGE_UNION_VOTES);

		const source = await readSuggestionState(SEED_SG_MERGE_SOURCE_ID);
		expect(source.mergedIntoId).toBe(SEED_SG_MERGE_TARGET_ID);

		// Off the board, but reachable by URL with an explanation — no redirect.
		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: SEED_SG_MERGE_SOURCE_TITLE })).toHaveCount(0);
	});
});

test.describe('reporting a suggestion', () => {
	test('a report hides the post from everyone but its author', async ({ page }) => {
		await login(page, SEED_SG_REPORTER_EMAIL, SEED_SG_PASSWORD);
		await reportSuggestion(page, SEED_SG_DISMISS_ID, 'E2E: reads like spam');

		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_DISMISS_ID)).visibility, DB_POLL)
			.toBe('under_review');

		// Gone for the reporter...
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: SEED_SG_DISMISS_TITLE })).toHaveCount(0);

		// ...and for someone who had nothing to do with the report.
		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: SEED_SG_DISMISS_TITLE })).toHaveCount(0);
		// 404, not 403 — a 403 would confirm it exists and turn reporting into an
		// enumeration oracle.
		await page.goto(`/member/suggestions/${SEED_SG_DISMISS_ID}`);
		await expect(page.getByText(SEED_SG_DISMISS_TITLE)).toHaveCount(0);

		// The author can still reach their own post, and is told why it's down.
		await switchUser(page, SEED_SG_AUTHOR_EMAIL, SEED_SG_PASSWORD);
		await page.goto(`/member/suggestions/${SEED_SG_DISMISS_ID}`);
		await expect(page.getByText(/off the board while staff take a look/i)).toBeVisible();
	});

	test('dismissing the report puts the suggestion straight back', async ({ page }) => {
		// The single highest-consequence behaviour in the feature: if dismissal
		// left it hidden, one report from any member would be a permanent takedown.
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await decideReport(page, SEED_SG_DISMISS_TITLE, 'dismissed');

		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_DISMISS_ID)).visibility, DB_POLL)
			.toBe('visible');

		// And the author's standing is untouched — a dismissed report costs nothing.
		expect(await readSuggestionStanding(SEED_SG_AUTHOR_ID)).toBe(false);

		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: SEED_SG_DISMISS_TITLE })).toBeVisible();
	});

	test('upholding keeps it down and puts the author on review', async ({ page }) => {
		await login(page, SEED_SG_REPORTER_EMAIL, SEED_SG_PASSWORD);
		await reportSuggestion(page, SEED_SG_UPHOLD_ID, 'E2E: self-dealing');
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_UPHOLD_ID)).visibility, DB_POLL)
			.toBe('under_review');

		await switchUser(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await decideReport(page, SEED_SG_UPHOLD_TITLE, 'resolved');

		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_UPHOLD_ID)).visibility, DB_POLL)
			.toBe('hidden');
		await expect.poll(async () => readSuggestionStanding(SEED_SG_AUTHOR_ID), DB_POLL).toBe(true);

		// The consequence reaches forward: the author's NEXT post is withheld.
		await switchUser(page, SEED_SG_AUTHOR_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByText(/go to staff for a look before they appear/i)).toBeVisible();

		await page.getByRole('button', { name: 'Suggest something' }).click();
		await page.locator('input[name="title"]').fill('E2E Post While On Review');
		await page.locator('textarea[name="body"]').fill('Should wait for staff before appearing.');
		await page.getByRole('button', { name: 'Post it' }).click();
		await page.waitForURL(/\/member\/suggestions\/[^/]+$/, DB_POLL);
		await expect(page.getByText(/waiting for staff to look at it/i)).toBeVisible();

		// Nobody else can see it yet.
		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: 'E2E Post While On Review' })).toHaveCount(0);

		// Staff approve it out of the review queue, and it lands on the board.
		await switchUser(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/suggestions');
		await page.getByRole('tab', { name: 'Needs review' }).click();
		await page.getByRole('link', { name: 'E2E Post While On Review' }).first().click();
		await page.waitForURL(/\/staff\/suggestions\/[^/]+$/);
		await page.getByRole('button', { name: 'Approve or reject' }).click();
		await page.locator('select[name="decision"]').selectOption('approve');
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });

		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: 'E2E Post While On Review' })).toBeVisible();
	});
});

test.describe('access control', () => {
	test('a signed-out visitor cannot reach the board', async ({ page }) => {
		await page.context().clearCookies();
		await page.goto('/member/suggestions');
		await expect(page).toHaveURL(/\/login/);
	});

	test('a plain member cannot reach the staff queue', async ({ page }) => {
		await login(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/staff/suggestions');
		await expect(page).not.toHaveURL(/\/staff\/suggestions/);
	});
});

test.describe('editing a suggestion', () => {
	/** Open the author's own edit form and submit new text. */
	async function submitEdit(page: Page, suggestionId: string, title: string, body: string) {
		await page.goto(`/member/suggestions/${suggestionId}`);
		await page.getByRole('button', { name: /^(Edit|Request an edit)$/ }).click();
		await page.locator('input[name="title"]').fill(title);
		await page.locator('textarea[name="body"]').fill(body);
		await page.getByRole('button', { name: /^(Save|Send to staff)$/ }).click();
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
	}

	test('the author can rewrite freely while nobody else has voted', async ({ page }) => {
		await login(page, SEED_SG_AUTHOR_EMAIL, SEED_SG_PASSWORD);
		await page.goto(`/member/suggestions/${SEED_SG_UNVOTED_ID}`);

		// The label is the promise: this one saves, it does not queue.
		await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

		await submitEdit(page, SEED_SG_UNVOTED_ID, 'E2E Rewritten Directly', 'Rewritten body.');

		await expect
			.poll(async () => (await readSuggestionText(SEED_SG_UNVOTED_ID)).title, DB_POLL)
			.toBe('E2E Rewritten Directly');
		expect((await readSuggestionText(SEED_SG_UNVOTED_ID)).edited).toBe(true);
	});

	test('once someone else has voted, an edit becomes a request and the text does not move', async ({
		page
	}) => {
		// The bait-and-switch: collect votes on one thing, then swap in another.
		const before = await readSuggestionText(SEED_SG_VISIBLE_ID);

		await login(page, SEED_SG_AUTHOR_EMAIL, SEED_SG_PASSWORD);
		await page.goto(`/member/suggestions/${SEED_SG_VISIBLE_ID}`);

		// Different label, because it is a different operation.
		await expect(page.getByRole('button', { name: 'Request an edit' })).toBeVisible();

		await submitEdit(page, SEED_SG_VISIBLE_ID, 'E2E Swapped Out Title', 'Completely different.');

		// The words members voted for are still the words on the board.
		const after = await readSuggestionText(SEED_SG_VISIBLE_ID);
		expect(after.title).toBe(before.title);
		expect(after.body).toBe(before.body);

		// And the author is told it is pending rather than left guessing.
		await page.reload();
		await expect(page.getByText(/edit is with staff/i)).toBeVisible();

		// Nobody else sees the proposed text anywhere.
		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: 'E2E Swapped Out Title' })).toHaveCount(0);
	});

	test('staff approving the edit applies it and keeps the votes', async ({ page }) => {
		// Runs against its own seeded pending request, so it does not depend on the
		// member-side test above having run first.
		const votesBefore = (await readSuggestionState(SEED_SG_EDIT_ID)).voteCount;

		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/suggestions/${SEED_SG_EDIT_ID}`);

		// Staff see both versions before deciding — approving a change you cannot
		// see is the failure this flow exists to prevent.
		await expect(page.getByText('What members voted for')).toBeVisible();
		await expect(page.getByText(SEED_SG_EDIT_PROPOSED_TITLE)).toBeVisible();

		await page.getByRole('button', { name: 'Approve or reject' }).click();
		await page.locator('select[name="decision"]').selectOption('approve');
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });

		await expect
			.poll(async () => (await readSuggestionText(SEED_SG_EDIT_ID)).title, DB_POLL)
			.toBe(SEED_SG_EDIT_PROPOSED_TITLE);
		// Approving the words must not disturb the count.
		expect((await readSuggestionState(SEED_SG_EDIT_ID)).voteCount).toBe(votesBefore);
	});

	test("a member cannot edit someone else's suggestion", async ({ page }) => {
		await login(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto(`/member/suggestions/${SEED_SG_UNVOTED_ID}`);

		await expect(page.getByRole('button', { name: /^(Edit|Request an edit)$/ })).toHaveCount(0);
	});
});
