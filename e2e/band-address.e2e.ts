import { expect, test } from '@playwright/test';
import { E2E_PREVIEW_PORT } from './state-dir';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_RENAME_BAND_SLUG,
	SEED_RENAME_BAND_NAME
} from './fixtures/seed-band-onboarding';

/**
 * An owner changing their band's address, end to end: the settings form, the
 * navigation onto the new slug, and the old address still forwarding afterwards.
 *
 * This test mutates its band's slug, so it uses a band of its own
 * (SEED_RENAME_BAND_*) — running it against a slug the other subdomain tests
 * assert on would make Playwright's ordering decide whether those pass.
 */
const NEW_SLUG = 'e2e-renamed-band';
const PORT = E2E_PREVIEW_PORT;

async function login(page: import('@playwright/test').Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_OWNER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_OWNER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('an owner can move their band to a new address', async ({ page, request }) => {
	await login(page);
	await page.goto(`/band/${SEED_RENAME_BAND_SLUG}/settings`);

	await page.getByRole('button', { name: 'Change address' }).click();
	await page.locator('input[name="newSlug"]').fill(NEW_SLUG);
	await page.getByRole('button', { name: 'Change address' }).last().click();

	// The mutation refreshes nothing server-side — the client navigates, which is
	// what re-keys every slug-scoped query on the page.
	await page.waitForURL(new RegExp(`/band/${NEW_SLUG}/settings`), { timeout: 15000 });
	await expect(page.getByText(`${NEW_SLUG}.localhost`)).toBeVisible({ timeout: 15000 });

	// The released address keeps forwarding — for now.
	const oldSubdomain = await request.get(`http://${SEED_RENAME_BAND_SLUG}.localhost:${PORT}/`, {
		maxRedirects: 0
	});
	expect(oldSubdomain.status()).toBe(302);
	expect(oldSubdomain.headers()['location']).toContain(`${NEW_SLUG}.localhost:${PORT}`);

	// ...including the dashboard path, subpage and all.
	await page.goto(`/band/${SEED_RENAME_BAND_SLUG}/members`);
	await expect(page).toHaveURL(new RegExp(`/band/${NEW_SLUG}/members`), { timeout: 15000 });

	// ...and the public profile.
	await page.goto(`/directory/bands/${SEED_RENAME_BAND_SLUG}`);
	await expect(page).toHaveURL(new RegExp(`/directory/bands/${NEW_SLUG}`), { timeout: 15000 });
	await expect(page.getByRole('heading', { name: SEED_RENAME_BAND_NAME })).toBeVisible({
		timeout: 15000
	});
});
