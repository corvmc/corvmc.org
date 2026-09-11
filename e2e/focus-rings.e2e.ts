import { expect, test, type Page } from '@playwright/test';

/**
 * Every nav link in every panel reported `outline: none` under real keyboard
 * focus, so the sidebar was a run of invisible tab stops — twelve consecutive
 * ones in the band panel (#991). Read off the live element, because a rule
 * emitting in the stylesheet is not the same as it applying here.
 *
 * The split bar's sr-only slider, the other half of that walk (#995), is
 * covered by `SplitBar.svelte.spec.ts` — it needs no server.
 */
function ring(el: Element) {
	const s = getComputedStyle(el);
	return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
}

async function login(page: Page, email: string) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill('password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('a focused sidebar link is visible', async ({ page }) => {
	await login(page, 'regular@corvallismusic.org');
	const link = page.locator('.menu a[href="/member"]').first();
	await expect(link).toBeVisible();
	await link.focus();
	const r = await link.evaluate(ring);
	expect(r.style).not.toBe('none');
	expect(r.width).toBeGreaterThan(0);
});
