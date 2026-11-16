import { expect, test, type Page } from './fixtures/test';

/**
 * Two tests, not one journey. Filling a held page proves the text survives, but a
 * fill moves focus itself and hides whether focus survived, which needs a bare focus
 * and no typing until hydration is done.
 */
const search = (page: Page) => page.locator('input:is([name="q"], [name^="q/"])');

/** Hold the entry chunk back, which a slow phone does on its own. */
async function holdEntryChunk(page: Page) {
	const held = { count: 0 };
	await page.route('**/_app/immutable/entry/*.js', async (route) => {
		held.count++;
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	return held;
}

test('a search typed before hydration still reaches ?q=', async ({ page }) => {
	const held = await holdEntryChunk(page);

	await page.goto('/directory');
	await search(page).fill('sprockets');
	await expect(page).toHaveURL(/[?&]q=sprockets/);

	expect(held.count, 'the entry chunk was never intercepted').toBeGreaterThan(0);
	await expect(search(page)).toHaveValue('sprockets');
});

/**
 * The input must still hold focus after hydration, or the next keystrokes go to the
 * body: the wiped search in #2224. Svelte strips the `value` attribute once the
 * binding has hydrated, so typing only starts after that.
 */
test('focus given before hydration survives it', async ({ page }) => {
	const held = await holdEntryChunk(page);

	await page.goto('/directory', { waitUntil: 'commit' });
	await search(page).focus();
	await expect(search(page)).not.toHaveAttribute('value');
	expect(held.count, 'the entry chunk was never intercepted').toBeGreaterThan(0);

	await expect(search(page)).toBeFocused();
	await page.keyboard.type('sprockets');
	await expect(search(page)).toHaveValue('sprockets');
	await expect(page).toHaveURL(/[?&]q=sprockets/);
});
