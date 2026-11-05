import { test, expect, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
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
	SEED_SG_EDIT_TITLE,
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

/** Titles this spec types in itself, then looks for: fixture echo, not copy. */
const REVIEW_POST_TITLE = 'E2E Post While On Review';
const SWAPPED_TITLE = 'E2E Swapped Out Title';

/** The submit of whichever Action dialog is open; each has exactly one. */
const dialogSubmit = (page: Page) => page.getByRole('dialog').locator('button[type="submit"]');

async function login(page: Page, email: string, password: string) {
	await signInAs(page, { email, password });
}

/** Swap to somebody else; `signInAs` replaces the cookies outright. */
async function switchUser(page: Page, email: string, password: string) {
	await login(page, email, password);
}

/** File a report against a suggestion from its member-facing detail page. */
async function reportSuggestion(page: Page, suggestionId: string, reason: string) {
	await page.goto(`/member/suggestions/${suggestionId}`);
	await page.getByTestId('flag-suggestion').click();
	await page.locator('input:is([name="reason"], [name^="reason/"])').fill(reason);
	await dialogSubmit(page).click();
}

/** Resolve or dismiss the newest pending report from the staff flag queue. */
const SUBMIT_LABEL = {
	resolved: 'Resolve — action taken',
	dismissed: 'Dismiss — no action'
} as const;

async function decideReport(page: Page, entityTitle: string, decision: 'resolved' | 'dismissed') {
	await page.goto('/staff/flags');
	await page.getByRole('link', { name: entityTitle }).first().click();
	await page.waitForURL(/\/staff\/flags\/[^/]+$/);
	await page.getByTestId('resolve-flag').click();
	await page
		.locator('select:is([name="resolution"], [name^="resolution/"])')
		.selectOption(decision);
	// By the decision's own name, not "Save": the submit says what it will record,
	// which is the whole of #981. Clicking it by label is also the only assertion
	// that the dialog and the picked outcome agree.
	await page.getByRole('button', { name: SUBMIT_LABEL[decision] }).click();
	await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
}

test.describe('suggestion board', () => {
	test('a member sees the board, and voting is a toggle that never counts them twice', async ({
		page
	}) => {
		await login(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);

		// The board lists its seeded suggestions.
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: SEED_SG_VISIBLE_TITLE })).toBeVisible();
		// No feature flag gates this, so the nav item is simply there.
		await expect(page.locator('a[href="/member/suggestions"]').first()).toBeVisible();

		await page.goto(`/member/suggestions/${SEED_SG_DISMISS_ID}`);

		const before = (await readSuggestionState(SEED_SG_DISMISS_ID)).voteCount;

		// The control used to be `button "11"` with no pressed state, which is what
		// #903 fixed: it carries aria-pressed, and its name is more than the count.
		const vote = page.locator('main form button[type="submit"][aria-pressed]');
		await expect(vote).toHaveAttribute('aria-pressed', 'false');
		await expect(vote).not.toHaveAccessibleName(new RegExp(`^\\s*${before}\\s*$`));

		await vote.click();
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_DISMISS_ID)).voteCount, DB_POLL)
			.toBe(before + 1);
		await expect(vote).toHaveAttribute('aria-pressed', 'true');

		// Clicking again removes it rather than adding a second.
		await vote.click();
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_DISMISS_ID)).voteCount, DB_POLL)
			.toBe(before);
		await expect(vote).toHaveAttribute('aria-pressed', 'false');
	});

	test('a merged suggestion carries the union of both voter sets, not the sum', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/suggestions/${SEED_SG_MERGE_SOURCE_ID}`);

		await page.getByTestId('merge-suggestion').click();
		await page
			.locator('select:is([name="targetId"], [name^="targetId/"])')
			.selectOption(SEED_SG_MERGE_TARGET_ID);
		await dialogSubmit(page).click();

		// 3 voters on the target + 2 on the source, one of whom voted for both.
		// A correct merge lands on 4; double-counting lands on 5.
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_MERGE_TARGET_ID)).voteCount, DB_POLL)
			.toBe(SEED_SG_MERGE_UNION_VOTES);

		// Polled, not read once: `mergeSuggestions` transfers the votes and points
		// the source at the target in two separate writes (see the "Step 2" comment
		// in suggestion-service.ts — the split is what makes a half-finished merge
		// repairable). So the poll above proves step 1 landed and says nothing about
		// step 2, and a bare read here loses the race under CI load. It did, on the
		// merge-queue run for #282, taking a required check down with it.
		await expect
			.poll(async () => (await readSuggestionState(SEED_SG_MERGE_SOURCE_ID)).mergedIntoId, DB_POLL)
			.toBe(SEED_SG_MERGE_TARGET_ID);

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
		// The withheld notice renders through Alert (role="alert"); its sentence is
		// free to change, its presence is the behaviour under test.
		await expect(page.getByRole('alert')).toBeVisible();
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
		await expect(page.getByRole('alert')).toBeVisible();

		await page.locator('[data-page-header] button').click();
		await page.locator('input:is([name="title"], [name^="title/"])').fill(REVIEW_POST_TITLE);
		await page
			.locator('textarea:is([name="body"], [name^="body/"])')
			.fill('Should wait for staff before appearing.');
		await dialogSubmit(page).click();
		await page.waitForURL(/\/member\/suggestions\/[^/]+$/, DB_POLL);
		await expect(page.getByRole('alert')).toBeVisible();

		// Nobody else can see it yet.
		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: REVIEW_POST_TITLE })).toHaveCount(0);

		// Staff approve it out of the review queue, and it lands on the board.
		await switchUser(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/suggestions');
		await page.locator('#tab-review').click();
		await page.getByRole('link', { name: REVIEW_POST_TITLE }).first().click();
		await page.waitForURL(/\/staff\/suggestions\/[^/]+$/);
		await page.getByTestId('review-suggestion').click();
		await page.locator('select:is([name="decision"], [name^="decision/"])').selectOption('approve');
		await dialogSubmit(page).click();
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });

		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: REVIEW_POST_TITLE })).toBeVisible();
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
		await page.getByTestId('edit-suggestion').click();
		await page.locator('input:is([name="title"], [name^="title/"])').fill(title);
		await page.locator('textarea:is([name="body"], [name^="body/"])').fill(body);
		await dialogSubmit(page).click();
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
	}

	test('the author can rewrite freely while nobody else has voted', async ({ page }) => {
		await login(page, SEED_SG_AUTHOR_EMAIL, SEED_SG_PASSWORD);
		await page.goto(`/member/suggestions/${SEED_SG_UNVOTED_ID}`);

		await expect(page.getByTestId('edit-suggestion')).toBeVisible();

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

		await expect(page.getByTestId('edit-suggestion')).toBeVisible();

		await submitEdit(page, SEED_SG_VISIBLE_ID, SWAPPED_TITLE, 'Completely different.');

		// The words members voted for are still the words on the board.
		const after = await readSuggestionText(SEED_SG_VISIBLE_ID);
		expect(after.title).toBe(before.title);
		expect(after.body).toBe(before.body);

		// And the author is told it is pending rather than left guessing.
		await page.reload();
		await expect(page.getByRole('alert')).toBeVisible();

		// Nobody else sees the proposed text anywhere.
		await switchUser(page, SEED_SG_BYSTANDER_EMAIL, SEED_SG_PASSWORD);
		await page.goto('/member/suggestions');
		await expect(page.getByRole('link', { name: SWAPPED_TITLE })).toHaveCount(0);
	});

	test('staff approving the edit applies it and keeps the votes', async ({ page }) => {
		// Runs against its own seeded pending request, so it does not depend on the
		// member-side test above having run first.
		const votesBefore = (await readSuggestionState(SEED_SG_EDIT_ID)).voteCount;

		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/suggestions/${SEED_SG_EDIT_ID}`);

		// Staff see both versions before deciding — approving a change you cannot
		// see is the failure this flow exists to prevent.
		// One card holds both versions; the proposed title appears nowhere else.
		const compare = page.locator('.card').filter({ hasText: SEED_SG_EDIT_PROPOSED_TITLE });
		await expect(compare.getByText(SEED_SG_EDIT_TITLE, { exact: true })).toBeVisible();
		await expect(compare.getByText(SEED_SG_EDIT_PROPOSED_TITLE, { exact: true })).toBeVisible();

		await page.getByTestId('review-suggestion-edit').click();
		await page.locator('select:is([name="decision"], [name^="decision/"])').selectOption('approve');
		await dialogSubmit(page).click();
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

		await expect(page.getByTestId('edit-suggestion')).toHaveCount(0);
	});
});
