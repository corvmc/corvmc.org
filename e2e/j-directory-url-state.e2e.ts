import { expect, test, type Page } from './fixtures/test';

/**
 * The public directory's tab and search live in the query string, so a refresh, a
 * shared link or a back-navigation lands where you left. This keys off the tab
 * controls and the URL, not the cards: the number of cards depends on other fixtures.
 */

// The two in-page tabs are the only `main` links to `/directory` itself, not to a
// profile under it; musicians is the one that carries `tab=musicians`.
const directoryTabs = (page: Page) =>
	page.locator('main a[href^="/directory"]:not([href^="/directory/"])');
const bandsTab = (page: Page) =>
	directoryTabs(page).and(page.locator(':not([href*="tab=musicians"])'));
const musiciansTab = (page: Page) =>
	directoryTabs(page).and(page.locator('[href*="tab=musicians"]'));
const search = (page: Page) => page.locator('input:is([name="q"], [name^="q/"])');

test('the directory keeps its tab and search in the URL', async ({ page }) => {
	test.setTimeout(120_000);

	await test.step('the URL picks the tab', async () => {
		await page.goto('/directory');
		await expect(bandsTab(page)).toHaveAttribute('aria-current', 'page');
		await expect(musiciansTab(page)).not.toHaveAttribute('aria-current', 'page');

		await page.goto('/directory?tab=musicians');
		await expect(musiciansTab(page)).toHaveAttribute('aria-current', 'page');

		await page.goto('/directory?tab=banjos');
		await expect(bandsTab(page)).toHaveAttribute('aria-current', 'page');
	});

	// The filter mirror runs off local state, so if it rebuilt the URL from a copy of
	// the tab it would re-goto the tab you just left and Back would look broken.
	await test.step('Back after a tab switch returns to bands and stays', async () => {
		await page.goto('/directory');
		await musiciansTab(page).click();
		await expect(page).toHaveURL(/[?&]tab=musicians/);

		await page.goBack();
		await expect(page).not.toHaveURL(/[?&]tab=musicians/);
		await expect(bandsTab(page)).toHaveAttribute('aria-current', 'page');

		// Outlast the 300ms mirror debounce: this asserts that nothing happens.
		await page.waitForTimeout(600);
		await expect(page).not.toHaveURL(/[?&]tab=musicians/);
	});

	await test.step('a tab click writes the URL and survives a reload', async () => {
		await page.goto('/directory');
		await musiciansTab(page).click();
		await expect(page).toHaveURL(/[?&]tab=musicians/);

		await page.reload();
		await expect(musiciansTab(page)).toHaveAttribute('aria-current', 'page');
	});

	await test.step('a search mirrors to ?q=, survives a reload and a tab switch', async () => {
		await page.goto('/directory');
		await search(page).fill('sprockets');
		// The mirror is debounced at 300ms so a typed word costs one history rewrite.
		await expect(page).toHaveURL(/[?&]q=sprockets/);

		await page.reload();
		await expect(search(page)).toHaveValue('sprockets');

		await musiciansTab(page).click();
		await expect(page).toHaveURL(/[?&]tab=musicians/);
		await expect(search(page)).toHaveValue('sprockets');
	});
});
