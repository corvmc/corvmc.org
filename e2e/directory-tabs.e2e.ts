import { expect, test } from '@playwright/test';

/**
 * The public directory's tab and filters live in the query string so a refresh,
 * a shared link, or a back-navigation from a profile all land where you left.
 *
 * Assertions here deliberately key off the tab controls and the URL rather than
 * the cards: the e2e D1 is seeded with fixtures for other suites, so the number
 * of public bands and musicians is not something this test should depend on.
 */

// The two in-page tabs are the only `main` links to `/directory` itself, not
// to a profile under it; musicians is the one that carries `tab=musicians`.
const directoryTabs = (page: import('@playwright/test').Page) =>
	page.locator('main a[href^="/directory"]:not([href^="/directory/"])');
const bandsTab = (page: import('@playwright/test').Page) =>
	directoryTabs(page).and(page.locator(':not([href*="tab=musicians"])'));
const musiciansTab = (page: import('@playwright/test').Page) =>
	directoryTabs(page).and(page.locator('[href*="tab=musicians"]'));

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

/**
 * Holding the entry chunk back lands the fill on the server-rendered input,
 * which a slow phone does on its own. Hydration has to pick the typed text up
 * and the mirror has to write it, with no keystroke after hydration to help.
 */
test('a search typed before hydration still reaches ?q=', async ({ page }) => {
	let held = 0;
	await page.route('**/_app/immutable/entry/*.js', async (route) => {
		held++;
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});

	await page.goto('/directory');
	await page.locator('input[name="q"]').fill('sprockets');
	await expect(page).toHaveURL(/[?&]q=sprockets/);

	expect(held, 'the entry chunk was never intercepted, so nothing was delayed').toBeGreaterThan(0);
	await expect(page.locator('input[name="q"]')).toHaveValue('sprockets');
});

/**
 * Focus lands on the server-rendered input, then hydration finishes. The input
 * must still hold focus, or the next keystrokes go to the body — the wiped
 * search in #2224. The `value` attribute is the marker: Svelte strips it once
 * the binding has hydrated, so typing only starts after hydration.
 */
test('focus given before hydration survives it', async ({ page }) => {
	let held = 0;
	await page.route('**/_app/immutable/entry/*.js', async (route) => {
		held++;
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});

	await page.goto('/directory', { waitUntil: 'commit' });
	const search = page.locator('input[name="q"]');
	await search.focus();
	await expect(search).not.toHaveAttribute('value');
	expect(held, 'the entry chunk was never intercepted, so nothing was delayed').toBeGreaterThan(0);

	await expect(search).toBeFocused();
	await page.keyboard.type('sprockets');
	await expect(search).toHaveValue('sprockets');
	await expect(page).toHaveURL(/[?&]q=sprockets/);
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
