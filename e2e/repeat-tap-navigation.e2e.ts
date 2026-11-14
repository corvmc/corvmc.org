import { expect, test, type Page } from './fixtures/test';

/**
 * Kit writes the destination to history before the new page renders, so while its
 * queries are pending the old page is still on screen under the new URL. A second
 * tap on the same link then reads as a link to the current page, which kit answers
 * with `refreshAll()`: every cached query resets and refetches (#2477).
 */
const LAYOUT_QUERY = /\/_app\/remote\/[^/]+\/(getMe|getFooterInfo)(\?|$)/;

/** Resolves after a task queued behind kit's own rAF-then-timeout wait in its click handler. */
const pastKitsClickWait = (page: Page) =>
	page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(() => r(), 0)))
	);

test('a second tap on a link mid-navigation refetches nothing', async ({ page }) => {
	let release = () => {};
	const held = new Promise<void>((r) => (release = r));
	let destinationRequests = 0;
	await page.route('**/_app/remote/*/getPublicGroups*', async (route) => {
		destinationRequests++;
		await held;
		await route.continue();
	});

	// The station bar asks for its state from `onMount`, so this is hydration done.
	const hydrated = page.waitForRequest(/\/_app\/remote\/[^/]+\/getRadioState/);
	await page.goto('/about');
	await hydrated;

	const layoutRequests: string[] = [];
	page.on('request', (r) => {
		if (LAYOUT_QUERY.test(r.url())) layoutRequests.push(r.url());
	});

	const link = page.locator('header a[href="/programs"]:visible').first();
	await link.click();
	await expect(page).toHaveURL(/\/programs$/);
	await expect.poll(() => destinationRequests).toBe(1);

	await link.click();
	await pastKitsClickWait(page);
	await pastKitsClickWait(page);

	const answered = page.waitForResponse(/\/_app\/remote\/[^/]+\/getPublicGroups/);
	release();
	await answered;
	await pastKitsClickWait(page);

	expect(layoutRequests, 'the layout queries were fetched again').toEqual([]);
	expect(destinationRequests, 'the pending page query was fetched again').toBe(1);
});
