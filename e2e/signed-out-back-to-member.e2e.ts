import { expect, test, type Page } from '@playwright/test';

/** A client-side visit, which is what makes `getMemberLayout` answer with a redirect. */
async function visitMemberPage(page: Page) {
	await page.evaluate(() =>
		document.body.insertAdjacentHTML(
			'afterbegin',
			'<a id="to-member" href="/member/volunteer/committees">x</a>'
		)
	);
	await page.locator('#to-member').click();
	await expect(page).toHaveURL(/\/login/);
}

/**
 * Signed out, the member layout redirects from inside its query. Coming back to
 * it from sign-in re-enters that layout, and the panel tabs must not read an
 * absent layout.
 */
test('returning to a member page while signed out throws nothing', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/about');
	await visitMemberPage(page);
	await visitMemberPage(page);
	await page.waitForLoadState('networkidle');

	expect(errors).toEqual([]);
});
