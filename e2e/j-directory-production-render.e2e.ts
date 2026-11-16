import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import {
	SEED_STAFF_EMAIL,
	SEED_STAFF_PASSWORD,
	SEED_TARGET_ID,
	SEED_TARGET_NAME
} from './fixtures/seed-staff-user';
import { SEED_PUBLIC_BAND_SLUG, SEED_PUBLIC_BAND_NAME } from './fixtures/seed-band-onboarding';

/**
 * These pages held three remote queries in flight, which past kit 2.64 does not render
 * at all: the boundary shows a minified internals error (JAVASCRIPT-SVELTEKIT-1V). Must
 * run against build + preview, because dev builds never show it. A crash either reaches
 * a boundary, which draws its failed alert, or escapes to +error.svelte with a 500.
 */
async function open200(page: Page, path: string) {
	const response = await page.goto(path);
	expect(response?.status()).toBe(200);
}

/** Checked after the content: the failed state replaces it once hydrated. */
async function expectNoBoundaryFailure(page: Page) {
	await expect(page.locator('[data-boundary-failed]')).toHaveCount(0);
}

test('member-side directory pages render in the production build', async ({ page }) => {
	test.setTimeout(120_000);
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });

	await test.step('a band profile', async () => {
		await open200(page, `/member/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);
		await expect(page.locator('body')).toContainText(SEED_PUBLIC_BAND_NAME);
		await expectNoBoundaryFailure(page);
	});

	await test.step('a musician profile', async () => {
		await open200(page, `/member/directory/members/${SEED_TARGET_ID}`);
		await expect(page.getByRole('heading').first()).toBeVisible();
		await expectNoBoundaryFailure(page);
	});

	// Filtered rather than scanned: the page renders a first slice of 42 members.
	await test.step('a member is found by search in the member directory', async () => {
		await page.goto('/member/directory');
		await page.locator('.directory-filters input[type="text"]').first().fill(SEED_TARGET_NAME);
		await expect(page.getByRole('link', { name: new RegExp(SEED_TARGET_NAME) })).toBeVisible();
	});

	await page.context().clearCookies();

	// The seeded member is `members`-visible, so the gate has to keep them off the
	// logged-out list, not only off their profile.
	await test.step('and is absent from the public one', async () => {
		await page.goto('/directory?tab=musicians');
		await page.locator('input:is([name="q"], [name^="q/"])').fill(SEED_TARGET_NAME);
		await expect(page).toHaveURL(/[?&]q=/);
		await expect(page.getByRole('link', { name: new RegExp(SEED_TARGET_NAME) })).toHaveCount(0);
	});

	// The footer sits outside the layout's ErrorToastBoundary, so a failed query there
	// could take the whole route out to +error.svelte (JAVASCRIPT-SVELTEKIT-2H).
	await test.step('the public footer renders under the home page', async () => {
		await open200(page, '/');
		await expect(page.locator('footer').locator('a[href="/contact"]')).toBeVisible();
		await expectNoBoundaryFailure(page);
	});
});
