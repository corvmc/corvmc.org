import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD, SEED_TARGET_ID } from './fixtures/seed-staff-user';
import { SEED_PUBLIC_BAND_SLUG, SEED_PUBLIC_BAND_NAME } from './fixtures/seed-band-onboarding';

/**
 * The member-side directory profiles, in PRODUCTION builds.
 *
 * These pages each held three remote queries in flight — the profile, the shows, and
 * `getMemberLayout()` for two permission booleans. Past kit 2.64 that is not a slow page, it is
 * a page that does not render: Svelte's reactivity blows up and the boundary shows a minified
 * internals error instead (`TypeError: null is not an object (evaluating 'W.f')`,
 * JAVASCRIPT-SVELTEKIT-1V, reported from Mobile Safari against a real band's URL).
 *
 * The public twin of this is `directory-profile-404.e2e.ts`, which pins the same failure on the
 * logged-out pages. Both must run against build + preview: dev builds are unaffected, because
 * the symptom is the minified frame reaching the boundary first.
 */

async function login(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('a member-side band profile renders the band, not a minified internals error', async ({
	page
}) => {
	await login(page);
	await page.goto(`/member/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);

	await expect(page.locator('body')).toContainText(SEED_PUBLIC_BAND_NAME);
	await expect(page.locator('body')).not.toContainText('Cannot read properties');
	await expect(page.locator('body')).not.toContainText('effect_update_depth_exceeded');
});

test('a member-side musician profile renders, not a minified internals error', async ({ page }) => {
	await login(page);
	await page.goto(`/member/directory/members/${SEED_TARGET_ID}`);

	await expect(page.locator('body')).not.toContainText('Cannot read properties');
	await expect(page.locator('body')).not.toContainText('effect_update_depth_exceeded');
	// Something rendered where the profile goes — the failure mode replaces the whole page.
	await expect(page.getByRole('heading').first()).toBeVisible();
});

/**
 * The footer is a sibling of <main>, so it sits outside the layout's ErrorToastBoundary. Its two
 * concurrent queries could therefore take the entire route out to +error.svelte over an address
 * that failed to load (JAVASCRIPT-SVELTEKIT-2H). It is one query now, inside its own boundary.
 */
test('the public footer renders alongside the page it sits under', async ({ page }) => {
	await page.goto('/');

	const footer = page.locator('footer');
	await expect(footer).toContainText('Corvallis Music Collective');
	await expect(footer.getByRole('link', { name: 'Contact' })).toBeVisible();
	await expect(page.locator('body')).not.toContainText('Cannot read properties');
});
