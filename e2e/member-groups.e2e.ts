import { expect, test, type Page } from '@playwright/test';
import {
	SEED_BANDMATE_EMAIL,
	SEED_BANDMATE_ID,
	SEED_BANDMATE_PASSWORD,
	SEED_PUBLIC_BAND_NAME
} from './fixtures/seed-band-onboarding';
import {
	SEED_APPLY_NAME,
	SEED_CLUB_SLUG,
	SEED_JOINABLE_INSTRUCTIONS,
	SEED_HIDDEN_SLUG,
	SEED_JOINABLE_NAME,
	SEED_JOINABLE_SLUG,
	readMemberStatus
} from './fixtures/seed-groups';

// `readLocalDb` opens the file the preview server is still writing through
// workerd, so a fresh reader can see stale rows — poll rather than read once.
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

/**
 * `/member/groups` — membership and discovery on one page.
 *
 * What is worth a browser here is the pair of self-service doors. Both write,
 * both are one click from a page anyone can reach, and the difference between
 * them is a status value that looks identical in a diff: `open` lands you
 * active with no approval, `by_application` parks you at `'requested'` and you
 * are *not* a member until somebody says so. A unit test can prove the service
 * writes the right row; only this can prove the right button reached it.
 */

async function loginAsMember(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_BANDMATE_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_BANDMATE_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('member groups index', () => {
	test('separates what you could join from what you can only be invited to', async ({ page }) => {
		await loginAsMember(page);
		await page.goto('/member/groups');

		// `goto` resolves before an awaited remote query commits, so wait on a
		// section rather than asserting against an empty <main>.
		await expect(page.getByRole('heading', { name: 'Open to join' })).toBeVisible();
		await expect(page.getByText(SEED_JOINABLE_NAME)).toBeVisible();

		await expect(page.getByRole('heading', { name: 'Apply to join' })).toBeVisible();
		await expect(page.getByText(SEED_APPLY_NAME)).toBeVisible();

		// The group's own words, next to the button rather than buried on a
		// detail page nobody opens before deciding.
		await expect(page.getByText(SEED_JOINABLE_INSTRUCTIONS)).toBeVisible();
	});

	/**
	 * A band is a group in the data model, and this is the page that must not say
	 * so. Bands are always `invite_only`, so they could never appear under
	 * discovery, and a member's own bands already have `/member/bands`.
	 */
	test('never lists a band, in any section', async ({ page }) => {
		await loginAsMember(page);
		await page.goto('/member/groups');
		await expect(page.getByRole('heading', { name: 'Open to join' })).toBeVisible();

		await expect(page.getByText(SEED_PUBLIC_BAND_NAME)).toHaveCount(0);
	});

	test('joining an open group makes you a member on the spot', async ({ page }) => {
		await loginAsMember(page);
		await page.goto('/member/groups');

		// By the trigger's accessible name, which names the group. Scoping by
		// surrounding text does not work and is not merely awkward: `InfoCard`
		// renders a `.card` around the whole section, so a `.card`-scoped locator
		// matched every group in it and this test silently joined a different one.
		await page.getByRole('button', { name: `Join ${SEED_JOINABLE_NAME}` }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Join' }).click();

		// No approval step, and three things say so. The group moves into "Your
		// programs" on this page, the roster row itself reads `'active'`, and the
		// "My Groups" sidebar picks it up.
		//
		// The row read is the strictest of the three — it distinguishes
		// `'pending'` from `'requested'` rather than just excluding both — and the
		// sidebar is kept beside it because it is the launched surface: it lists
		// active rows only, so its absence would mean the join landed in a waiting
		// state even though the page said otherwise.
		await expect(
			page.getByRole('main').getByRole('link', { name: SEED_JOINABLE_NAME, exact: true })
		).toBeVisible({ timeout: 15000 });
		await expect
			.poll(() => readMemberStatus(SEED_JOINABLE_SLUG, SEED_BANDMATE_ID), DB_POLL)
			.toBe('active');
		await expect(
			page.locator('aside').getByRole('link', { name: new RegExp(SEED_JOINABLE_NAME) })
		).toBeVisible({ timeout: 15000 });

		await page.goto(`/member/groups/${SEED_JOINABLE_SLUG}`);
		await expect(page.getByRole('heading', { name: SEED_JOINABLE_NAME })).toBeVisible();
	});

	test('applying leaves you waiting, not a member', async ({ page }) => {
		await loginAsMember(page);
		await page.goto('/member/groups');

		await page.getByRole('button', { name: `Apply to ${SEED_APPLY_NAME}` }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Send application' }).click();

		// Applying is not membership: the Apply button is withdrawn rather than
		// replaced by a members-only surface.
		await expect(page.getByRole('button', { name: `Apply to ${SEED_APPLY_NAME}` })).toHaveCount(0, {
			timeout: 15000
		});
	});
});

test.describe('the club page', () => {
	/**
	 * `requireGroupRole` resolves nothing for a non-member, and the page answers
	 * with the index rather than an error boundary or an empty shell. A 404 still
	 * 404s — "you cannot see this" and "this does not exist" are different
	 * answers.
	 */
	test('sends a non-member back to the index', async ({ page }) => {
		await loginAsMember(page);
		// Seeded, and this member is deliberately not on its roster.
		await page.goto(`/member/groups/${SEED_CLUB_SLUG}`);

		await page.waitForURL('**/member/groups', { timeout: 15000 });
		await expect(page.getByRole('heading', { name: 'Your programs' })).toBeVisible();
	});
});

test.describe('the public group directory', () => {
	/**
	 * `visibility = 'public'` is the whole of the decision about what appears
	 * here, and it is the same column a band's listing uses — which is the point
	 * of a club having a directory entry rather than a listing shape of its own.
	 */
	test('lists public programs to a signed-out visitor', async ({ page }) => {
		await page.goto('/groups');

		await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
		await expect(page.getByRole('link', { name: SEED_JOINABLE_NAME })).toBeVisible();
	});

	/**
	 * The Join button is the only write on a public page, and it needs a session.
	 * A prompt that brings them back beats a button that fails.
	 */
	test('offers a signed-out visitor a way in, not a button that fails', async ({ page }) => {
		await page.goto(`/groups/${SEED_JOINABLE_SLUG}`);

		await expect(page.getByRole('heading', { name: SEED_JOINABLE_NAME })).toBeVisible();
		await expect(page.getByText(SEED_JOINABLE_INSTRUCTIONS)).toBeVisible();

		// Scoped to `main`: the public header carries its own "Sign In" link.
		const signIn = page.getByRole('main').getByRole('link', { name: 'Sign in' });
		await expect(signIn).toBeVisible();
		await expect(signIn).toHaveAttribute('href', `/login?redirect=/groups/${SEED_JOINABLE_SLUG}`);
	});

	/** A members-only or hidden program has no public page at all. */
	test('404s a group that is not public', async ({ page }) => {
		const res = await page.goto(`/groups/${SEED_HIDDEN_SLUG}`);
		expect(res?.status()).toBe(404);
	});
});
