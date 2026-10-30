import { expect, test, type Page } from '@playwright/test';
import { SEED_MEMBER_EMAIL, SEED_MEMBER_PASSWORD } from './fixtures/seed-pay-reservation';

/**
 * Regression test for the create-band modal dying after a client-side
 * navigation (JAVASCRIPT-SVELTEKIT-Q / -1A family).
 *
 * With `compilerOptions.experimental.async`, a top-level `await` in a page
 * script marks every later declaration as "blocked": the compiler moves their
 * initialization into a post-await continuation and wraps every template
 * expression that references them in an async block. On /member/bands,
 * `showCreateModal` was declared after `await getMemberBands()`, so the
 * create-band <Modal> and the header button's onclick were both gated on that
 * continuation. When a client-side navigation reached the page while the
 * member layout's own async work was still settling (e.g. right after login),
 * the Modal's async block never committed — the header "Create Band" button
 * rendered and its handler ran, but no dialog ever mounted. Timing-dependent:
 * reliably reproduced in headless Chromium, usually invisible in headed
 * browsers.
 *
 * The fix declares the modal state before the await (and NotificationBell got
 * the same treatment for its window click handler, which crashed with
 * "Cannot read properties of undefined (reading 'f')" when clicked before its
 * awaited query resolved — the Sentry Q/1A crash).
 *
 * This test intentionally navigates CLIENT-SIDE immediately after login (the
 * turbulent window) rather than with page.goto(), which full-loads the page
 * and never raced.
 */

async function login(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_MEMBER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_MEMBER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('create-band modal opens after an immediate client-side navigation', async ({ page }) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));

	await login(page);

	// Client-side navigation via a same-origin anchor (SvelteKit intercepts the
	// click). Injected because the sidebar's own "Create Band" links are being
	// repointed at /member/bands on another branch; this test only needs *a*
	// client-side navigation to the bands page during the post-login window.
	await page.evaluate(() => {
		const a = document.createElement('a');
		a.href = '/member/bands';
		a.id = 'e2e-spa-nav';
		a.textContent = 'bands';
		a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
		document.body.appendChild(a);
	});
	await page.click('#e2e-spa-nav');
	await page.waitForURL(/\/member\/bands/, { timeout: 15000 });

	await page.getByRole('button', { name: 'Create Band' }).click();
	await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
	await expect(page.getByRole('dialog').locator('input[name="name"]')).toBeVisible();

	// The same turbulent window used to crash NotificationBell's window click
	// handler ("reading 'f'") — any page error here is a regression.
	expect(pageErrors).toEqual([]);
});
