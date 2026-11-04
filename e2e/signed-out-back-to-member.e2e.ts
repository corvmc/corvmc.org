import { expect, test } from '@playwright/test';

/**
 * Signed out, a client-side visit to a member page redirects to sign-in from
 * inside `getMemberLayout`. Going back re-enters the member layout with that
 * query already settled, and the panel tabs must not read an absent layout.
 */
test('going back to a member page while signed out throws nothing', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/about');
	await page.evaluate(() => {
		const a = document.createElement('a');
		a.href = '/member/volunteer/committees';
		a.id = 'to-member';
		a.textContent = 'x';
		document.body.prepend(a);
	});
	await page.locator('#to-member').click();
	await expect(page).toHaveURL(/\/login/);

	await page.goBack();
	await expect(page).toHaveURL(/\/login|\/member\/volunteer\/committees/);
	await page.waitForLoadState('networkidle');

	expect(errors).toEqual([]);
});
