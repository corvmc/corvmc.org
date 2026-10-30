import { expect, test } from '@playwright/test';

/**
 * The public directory's tab and filters live in the query string so a refresh,
 * a shared link, or a back-navigation from a profile all land where you left.
 *
 * Assertions here deliberately key off the tab controls and the URL rather than
 * the cards: the e2e D1 is seeded with fixtures for other suites, so the number
 * of public bands and musicians is not something this test should depend on.
 */

const bandsTab = (page: import('@playwright/test').Page) =>
	page.getByRole('link', { name: /Bands/ });
const musiciansTab = (page: import('@playwright/test').Page) =>
	page.getByRole('link', { name: /Musicians/ });

test('bands is the default tab and the clean URL', async ({ page }) => {
	await page.goto('/directory');

	await expect(bandsTab(page)).toHaveAttribute('aria-current', 'page');
	await expect(musiciansTab(page)).not.toHaveAttribute('aria-current', 'page');
});

test('?tab=musicians selects musicians', async ({ page }) => {
	await page.goto('/directory?tab=musicians');

	await expect(musiciansTab(page)).toHaveAttribute('aria-current', 'page');
});

test('a junk ?tab= falls back to bands rather than rendering nothing', async ({ page }) => {
	await page.goto('/directory?tab=banjos');

	await expect(bandsTab(page)).toHaveAttribute('aria-current', 'page');
});

test('switching tabs writes the URL and survives a reload', async ({ page }) => {
	await page.goto('/directory');

	await musiciansTab(page).click();
	await expect(page).toHaveURL(/[?&]tab=musicians/);

	await page.reload();
	await expect(musiciansTab(page)).toHaveAttribute('aria-current', 'page');
});

test('search is mirrored into ?q= and survives a reload', async ({ page }) => {
	await page.goto('/directory');

	await page.locator('input[name="q"]').fill('sprockets');
	// The mirror is debounced at 300ms so a typed word costs one history rewrite.
	await expect(page).toHaveURL(/[?&]q=sprockets/);

	await page.reload();
	await expect(page.locator('input[name="q"]')).toHaveValue('sprockets');
});

test('the search survives a tab switch', async ({ page }) => {
	await page.goto('/directory');

	await page.locator('input[name="q"]').fill('sprockets');
	await expect(page).toHaveURL(/[?&]q=sprockets/);

	await musiciansTab(page).click();
	await expect(page).toHaveURL(/[?&]tab=musicians/);
	await expect(page.locator('input[name="q"]')).toHaveValue('sprockets');
});

test('back after a tab switch returns to bands and stays there', async ({ page }) => {
	// The regression this guards: the filter mirror runs off local state, so if
	// it rebuilt the URL from a state copy of the tab it would immediately
	// re-goto the tab you just left and the Back button would look broken.
	await page.goto('/directory');
	await musiciansTab(page).click();
	await expect(page).toHaveURL(/[?&]tab=musicians/);

	await page.goBack();
	await expect(page).not.toHaveURL(/[?&]tab=musicians/);
	await expect(bandsTab(page)).toHaveAttribute('aria-current', 'page');

	// Outlast the 300ms mirror debounce, then confirm nothing bounced us forward.
	await page.waitForTimeout(600);
	await expect(page).not.toHaveURL(/[?&]tab=musicians/);
});

test('the tabs are real links, not buttons', async ({ page }) => {
	// They render as anchors so middle-click and open-in-new-tab work and the
	// target is copyable. Not yet crawlable — every `(public)` page currently
	// server-renders as the layout boundary's pending spinner, which PR #180
	// fixes; once it lands these anchors reach crawlers unchanged.
	await page.goto('/directory');

	await expect(musiciansTab(page)).toHaveAttribute('href', /\/directory\?tab=musicians/);
	await expect(bandsTab(page)).toHaveAttribute('href', /\/directory$/);
});
