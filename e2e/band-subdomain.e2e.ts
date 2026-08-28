import { expect, test } from '@playwright/test';
import { E2E_PREVIEW_PORT } from './state-dir';
import {
	SEED_PUBLIC_BAND_SLUG,
	SEED_PUBLIC_BAND_NAME,
	SEED_PUBLIC_BAND_OLD_SLUG,
	SEED_PREMIUM_BAND_SLUG,
	SEED_PREMIUM_BAND_NAME
} from './fixtures/seed-band-onboarding';

/**
 * Every band has {slug}.<domain>, free. What it serves depends on tier:
 * premium bands get their block-editor microsite, everyone else is redirected
 * to their directory profile — so a band can hand out the address either way.
 *
 * The base domain comes from PUBLIC_SITE_URL, which playwright.config.ts pins
 * to this checkout's preview origin, making {slug}.localhost:<port> a real band
 * address that exercises the same hooks as {slug}.corvmc.org in production.
 */
const PORT = E2E_PREVIEW_PORT;
const subdomain = (slug: string) => `http://${slug}.localhost:${PORT}`;

test('a free band subdomain redirects to its directory profile', async ({ page }) => {
	const response = await page.goto(`${subdomain(SEED_PUBLIC_BAND_SLUG)}/`);

	expect(response?.status()).toBe(200); // after following the redirect
	expect(page.url()).toContain(`/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);
	await expect(page.getByRole('heading', { name: SEED_PUBLIC_BAND_NAME })).toBeVisible({
		timeout: 15000
	});
});

test('the redirect is a real 302, not a client-side bounce', async ({ request }) => {
	const response = await request.get(`${subdomain(SEED_PUBLIC_BAND_SLUG)}/`, {
		maxRedirects: 0
	});

	expect(response.status()).toBe(302);
	expect(response.headers()['location']).toContain(`/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);
});

test('a premium band subdomain serves its band site', async ({ page }) => {
	await page.goto(`${subdomain(SEED_PREMIUM_BAND_SLUG)}/`);

	// Stays on the subdomain — no redirect to the directory.
	expect(page.url()).toContain(`${SEED_PREMIUM_BAND_SLUG}.localhost`);
	expect(page.url()).not.toContain('/directory/');
	await expect(page).toHaveTitle(new RegExp(SEED_PREMIUM_BAND_NAME));
});

/**
 * An address a band released by changing its slug keeps forwarding — until some
 * other band claims it, at which point the live band wins and the redirect stops.
 */
/**
 * The microsite's gallery comes from `media` + `media_attachment` since the
 * phase-4 cut-over, not from `band_media`. A broken query renders an empty
 * gallery rather than an error, so without this the regression is silent — the
 * page still loads and still has the right title.
 *
 * **Asserts the section, not the `<img>`.** The EPK guards each image with
 * `{#if img.url}` and `resolveImageUrl()` yields null unless R2 is configured,
 * which it is not under `vite preview`. So the image element never renders here
 * however healthy the query is, while the "Photos" heading sits inside
 * `{#if galleryMedia.length > 0}` and therefore appears only when the media
 * tables actually returned a gallery row for this band.
 */
test('the premium microsite renders gallery media from the media tables', async ({ page }) => {
	await page.goto(`${subdomain(SEED_PREMIUM_BAND_SLUG)}/epk`);

	await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible();
});

test('an old subdomain forwards to the address the band moved to', async ({ request }) => {
	const response = await request.get(`${subdomain(SEED_PUBLIC_BAND_OLD_SLUG)}/`, {
		maxRedirects: 0
	});

	// 302, not 301: the old address is claimable again, so the redirect has to be
	// revocable.
	expect(response.status()).toBe(302);
	expect(response.headers()['location']).toContain(`${SEED_PUBLIC_BAND_SLUG}.localhost:${PORT}`);
});

test('following an old subdomain lands on the band', async ({ page }) => {
	await page.goto(`${subdomain(SEED_PUBLIC_BAND_OLD_SLUG)}/`);

	// Two hops: old subdomain → current subdomain → directory profile (free tier).
	expect(page.url()).toContain(`/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);
	await expect(page.getByRole('heading', { name: SEED_PUBLIC_BAND_NAME })).toBeVisible({
		timeout: 15000
	});
});

test('an old directory profile URL forwards to the current one', async ({ page }) => {
	await page.goto(`http://localhost:${PORT}/directory/bands/${SEED_PUBLIC_BAND_OLD_SLUG}`);

	expect(page.url()).toContain(`/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);
	await expect(page.getByRole('heading', { name: SEED_PUBLIC_BAND_NAME })).toBeVisible({
		timeout: 15000
	});
});

// Negative control for the three tests above: no history row, so no forward.
test('an unknown subdomain redirects to a directory 404 rather than erroring', async ({ page }) => {
	await page.goto(`${subdomain('no-such-band-xyz')}/`);

	expect(page.url()).toContain('/directory/bands/no-such-band-xyz');
	await expect(page.getByText(/not found/i).first()).toBeVisible({ timeout: 15000 });
});

test('the host-route lookup reports no band for an unrelated hostname', async ({ request }) => {
	const response = await request.get(
		`http://localhost:${PORT}/api/host-route?host=not-a-band.example.com`
	);

	expect(response.ok()).toBe(true);
	expect(await response.json()).toEqual({ slug: null });
});
