import { expect, test, type Page } from '@playwright/test';
import {
	SEED_STAFF_EMAIL,
	SEED_STAFF_PASSWORD,
	SEED_TARGET_ID,
	SEED_TARGET_NAME
} from './fixtures/seed-staff-user';
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

/**
 * The member directory LIST, the twin of `a public band appears in the public
 * directory list` in band-onboarding.e2e.ts.
 *
 * Members moved from `user` to `directory_entry` in phase 3a, and a member
 * without an entry silently drops out of the list. Nothing covered that: the
 * directory specs key off tab controls and URLs rather than cards, deliberately,
 * because the card count depends on other suites' fixtures. Asserting one named
 * member is present does not.
 */
test('a member appears in the member directory, and not in the public one', async ({ page }) => {
	await login(page);
	await page.goto('/member/directory');

	// Filtered rather than scanned: the fixtures seed 42 members and the page
	// renders a first slice of them, so asserting on a name straight away would
	// depend on where that slice happens to end. Typing also exercises the name
	// search, which runs against the entry's copy of the name since phase 3a.
	await page.getByPlaceholder('Search by name').fill(SEED_TARGET_NAME);
	await expect(page.getByRole('link', { name: new RegExp(SEED_TARGET_NAME) })).toBeVisible({
		timeout: 15000
	});

	// The seeded member is `members`-visible, so the visibility gate has to keep
	// them off the logged-out page — on the list, not only on their profile.
	await page.context().clearCookies();
	await page.goto('/directory?tab=musicians');
	// The public page names its search input `q` and mirrors it to the URL; the
	// member page keeps the term in local state. Different controls, so the two
	// halves of this test drive them differently.
	await page.locator('input[name="q"]').fill(SEED_TARGET_NAME);
	await expect(page.getByRole('link', { name: new RegExp(SEED_TARGET_NAME) })).toHaveCount(0);
});
