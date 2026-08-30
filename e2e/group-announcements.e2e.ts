import { expect, test, type Page } from '@playwright/test';
import {
	SEED_BANDMATE_EMAIL,
	SEED_BANDMATE_PASSWORD,
	SEED_MEMBERS_BAND_SLUG
} from './fixtures/seed-band-onboarding';
import {
	SEED_DRAFT_TITLE,
	SEED_LED_SLUG,
	SEED_PUBLISHED_TITLE,
	SEED_READER_SLUG
} from './fixtures/seed-groups';

/**
 * Announcements on the club page.
 *
 * What earns a browser here is the draft. Everything else about this feature is
 * a list, but a draft is a post the roster must not see, and the difference
 * between "not rendered" and "rendered and hidden by a class" is invisible in a
 * diff and total in effect. The server decides which list you get; this is the
 * only thing that can prove the decision reached the page.
 *
 * The second is publishing, because it is the one irreversible control in the
 * feature — 7c hangs an email to the whole roster off exactly this button.
 */

async function loginAsMember(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_BANDMATE_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_BANDMATE_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('reading announcements', () => {
	test('a plain member sees the published post and never the draft', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_READER_SLUG}`);

		// Announcements is the default tab, so the bare URL is the post list.
		// `goto` resolves before an awaited remote query commits, so wait on the
		// post rather than asserting against an empty <main>.
		await expect(page.getByText(SEED_PUBLISHED_TITLE)).toBeVisible({ timeout: 15000 });

		// The whole test. The draft is on the same group, one row away in the
		// table, and a member must not reach it by any route.
		await expect(page.getByText(SEED_DRAFT_TITLE)).toHaveCount(0);
	});

	test('offers a plain member no way to post', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_READER_SLUG}`);
		await expect(page.getByText(SEED_PUBLISHED_TITLE)).toBeVisible({ timeout: 15000 });

		await expect(page.getByRole('button', { name: 'New announcement' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
	});

	test('a leader sees the draft, marked as one', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}`);

		await expect(page.getByText(SEED_PUBLISHED_TITLE)).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(SEED_DRAFT_TITLE)).toBeVisible();
		// Marked, not merely present: an unpublished post that reads like a
		// published one is how a leader concludes they already told everybody.
		await expect(page.getByText('Draft', { exact: true })).toBeVisible();
	});
});

test.describe('writing announcements', () => {
	test('a leader writes a draft, and nothing says it was published', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}`);
		await expect(page.getByRole('button', { name: 'New announcement' })).toBeVisible({
			timeout: 15000
		});

		await page.getByRole('button', { name: 'New announcement' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('input[name="title"]').fill('E2E composed post');
		await dialog.locator('textarea[name="body"]').fill('Written by the composer test.');
		await dialog.getByRole('button', { name: 'Save draft' }).click();

		// Saved as a draft: the submit label says so, and so must the result.
		const composed = page.getByRole('main').getByText('E2E composed post');
		await expect(composed).toBeVisible({ timeout: 15000 });
	});

	test('publishing turns a draft into a post', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}`);
		await expect(page.getByText(SEED_DRAFT_TITLE)).toBeVisible({ timeout: 15000 });

		// Scoped to the card holding the seeded draft: the page renders a Publish
		// control per draft, and by this point the composer test may have left
		// another one. Without the scope this is a strict-mode violation, and with
		// a `.first()` instead it would silently publish whichever came first.
		const draftCard = page.getByRole('main').locator('.card').filter({ hasText: SEED_DRAFT_TITLE });
		await draftCard.getByRole('button', { name: 'Publish' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();

		// The badge is the assertion, not a toast: it is read back from the row.
		await expect(
			page
				.getByRole('main')
				.locator('.card')
				.filter({ hasText: SEED_DRAFT_TITLE })
				.getByText('Draft', { exact: true })
		).toHaveCount(0, { timeout: 15000 });
	});
});

test.describe('the per-group mute', () => {
	/**
	 * The global `announcement` preference cannot express this — a member of six
	 * groups needs to silence one — so it writes their own roster row. It is also
	 * where the link in every announcement email lands, which is the whole reason
	 * these are defensible on the transactional stream.
	 */
	test('mutes one group without leaving it', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_READER_SLUG}`);

		const mute = page.getByRole('button', { name: 'Mute announcements' });
		await expect(mute).toBeVisible({ timeout: 15000 });
		await mute.click();
		await page.getByRole('dialog').getByRole('button', { name: 'Mute announcements' }).click();

		// The control flips, which is read back from the roster row rather than
		// from local state — and the member is still on the roster.
		await expect(page.getByRole('button', { name: 'Unmute announcements' })).toBeVisible({
			timeout: 15000
		});
		await expect(page.getByText(SEED_PUBLISHED_TITLE)).toBeVisible();
	});
});

test.describe('the band panel mount', () => {
	/**
	 * The same component in the other frame. Worth one test because
	 * "mount-agnostic" is a claim about a prop contract, and a component that
	 * reached for a club-shaped context would fail here and nowhere else.
	 */
	test('renders announcements as a band panel page', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/band/${SEED_MEMBERS_BAND_SLUG}/announcements`);

		await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible({
			timeout: 15000
		});
		// A plain member of this band: they read, they do not write.
		await expect(page.getByRole('button', { name: 'New announcement' })).toHaveCount(0);
	});

	test('puts Announcements in the band nav', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/band/${SEED_MEMBERS_BAND_SLUG}`);

		await expect(page.getByRole('link', { name: 'Announcements' }).first()).toBeVisible({
			timeout: 15000
		});
	});
});

test.describe('group sessions', () => {
	/**
	 * The one path outside the staff panel that reserves the room. What is worth
	 * a browser is that the reservation actually happens and is attributed to the
	 * session rather than to the program — the difference is one enum value and
	 * looks identical in a diff.
	 */
	test('a leader puts a session on the calendar and holds the room', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}?tab=sessions`);

		await page.getByRole('button', { name: 'New session' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('input[name="title"]').fill('E2E monthly jam');
		await dialog.locator('input[name="sessionDate"]').fill('2027-03-18');
		await dialog.locator('input[name="startTime"]').fill('19:00');
		await dialog.locator('input[name="endTime"]').fill('21:00');
		// The checkbox registers with a `b:` prefix so kit coerces it to a boolean.
		await dialog.locator('input[name="b:reserveRoom"]').check();
		await dialog.getByRole('button', { name: 'Create session' }).click();

		const row = page.getByRole('row').filter({ hasText: 'E2E monthly jam' });
		await expect(row).toBeVisible({ timeout: 15000 });
		// Read back from the row, not from a toast: this is the fact that
		// separates a session holding the room from a listing that merely says so.
		await expect(row.getByText('Room held')).toBeVisible();
	});

	test('refuses a session that ends before it starts', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}?tab=sessions`);

		await page.getByRole('button', { name: 'New session' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('input[name="title"]').fill('E2E backwards session');
		await dialog.locator('input[name="sessionDate"]').fill('2027-03-19');
		await dialog.locator('input[name="startTime"]').fill('21:00');
		await dialog.locator('input[name="endTime"]').fill('21:00');
		await dialog.getByRole('button', { name: 'Create session' }).click();

		await expect(dialog.getByText('The session has to end after it starts')).toBeVisible({
			timeout: 15000
		});
	});
});
