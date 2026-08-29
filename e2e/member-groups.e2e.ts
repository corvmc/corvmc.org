import { expect, test, type Page } from '@playwright/test';
import {
	SEED_BANDMATE_EMAIL,
	SEED_BANDMATE_PASSWORD,
	SEED_PUBLIC_BAND_NAME
} from './fixtures/seed-band-onboarding';
import {
	SEED_APPLY_NAME,
	SEED_CLUB_SLUG,
	SEED_JOINABLE_INSTRUCTIONS,
	SEED_JOINABLE_NAME,
	SEED_JOINABLE_SLUG
} from './fixtures/seed-groups';

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

		// `.first()` is the trigger: `Action` renders its modal inside the card, so
		// the submit button carries the same label and is in the DOM before the
		// dialog opens. The submit is then reached through the dialog.
		const card = page.locator('.card', { hasText: SEED_JOINABLE_NAME });
		await card.getByRole('button', { name: 'Join' }).first().click();
		await page.getByRole('dialog').getByRole('button', { name: 'Join' }).click();

		// No approval step, and two places say so. The group moves into "Your
		// programs" on this page, and — because the membership is active rather
		// than pending — it appears in the My Groups sidebar too. The sidebar is
		// the stricter claim: it lists active rows only, so a row there is proof
		// the join did not land as `'pending'` or `'requested'`.
		await expect(
			page.getByRole('main').getByRole('link', { name: SEED_JOINABLE_NAME, exact: true })
		).toBeVisible({ timeout: 15000 });
		await expect(
			page.locator('aside').getByRole('link', { name: new RegExp(SEED_JOINABLE_NAME) })
		).toBeVisible();

		await page.goto(`/member/groups/${SEED_JOINABLE_SLUG}`);
		await expect(page.getByRole('heading', { name: SEED_JOINABLE_NAME })).toBeVisible();
	});

	test('applying leaves you waiting, not a member', async ({ page }) => {
		await loginAsMember(page);
		await page.goto('/member/groups');

		const card = page.locator('.card', { hasText: SEED_APPLY_NAME });
		await card.getByRole('button', { name: 'Apply' }).first().click();
		await page.getByRole('dialog').getByRole('button', { name: 'Send application' }).click();

		await expect(page.getByText('you asked to join')).toBeVisible({ timeout: 15000 });
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
