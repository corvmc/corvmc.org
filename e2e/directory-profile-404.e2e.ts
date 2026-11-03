import { expect, test, type Page } from '@playwright/test';

/**
 * Regression test for the public band-profile 404 message in PRODUCTION builds.
 *
 * Background: the band page had two sibling async deriveds —
 *   let data = $derived(await getPublicBandProfile(slug));
 *   let shows = $derived(await getBandShows(data.band.id));
 * When the profile query rejected with a 404 HttpError, the sibling derived
 * read `data.band.id` during the same flush; in the minified prod build a
 * TypeError from Svelte internals ("Cannot read properties of null (reading
 * 'f')") reached the svelte:boundary before the real 404, so the failed
 * snippet showed the internals error instead of "Band not found". Dev builds
 * were unaffected, which is why this must run against build + preview.
 */

/**
 * The boundary's failed alert, tagged with the error's status. The internals
 * TypeError carries none, so it can never satisfy a 404.
 */
function failedAs(page: Page, status: number) {
	return page.locator(`[data-error-status="${status}"] [role="alert"]`);
}

test('band profile 404 reaches the boundary as a 404, not a minified internals error', async ({
	page
}) => {
	await page.goto('/directory/bands/does-not-exist-xyz');

	await expect(failedAs(page, 404)).toBeVisible();
});

test('member profile 404 reaches the boundary as a 404, not a minified internals error', async ({
	page
}) => {
	await page.goto('/directory/members/does-not-exist-xyz');

	await expect(failedAs(page, 404)).toBeVisible();
});
