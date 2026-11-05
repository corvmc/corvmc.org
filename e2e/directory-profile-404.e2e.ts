import { expect, test, type Page } from './fixtures/test';

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
 * The page answers 404 and says so, without the copy: the error page renders
 * `page.status`, and the minified internals TypeError would have been a 500.
 */
async function expect404(page: Page, path: string) {
	const response = await page.goto(path);
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${response?.status()}`);
	await expect(page.locator('[data-boundary-failed]')).toHaveCount(0);
}

test('band profile 404 answers 404, not a minified internals error', async ({ page }) => {
	await expect404(page, '/directory/bands/does-not-exist-xyz');
});

test('member profile 404 answers 404, not a minified internals error', async ({ page }) => {
	await expect404(page, '/directory/members/does-not-exist-xyz');
});
