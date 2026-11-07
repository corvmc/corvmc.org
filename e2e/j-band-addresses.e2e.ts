import { expect, test } from './fixtures/test';
import { E2E_PREVIEW_PORT } from './state-dir';
import {
	SEED_PUBLIC_BAND_SLUG,
	SEED_PUBLIC_BAND_NAME,
	SEED_PUBLIC_BAND_OLD_SLUG,
	SEED_PREMIUM_BAND_SLUG,
	SEED_PREMIUM_BAND_NAME
} from './fixtures/seed-band-onboarding';

/**
 * Every band has {slug}.<domain>: premium bands get their microsite, everyone else
 * a redirect to their directory profile. PUBLIC_SITE_URL is pinned to this
 * checkout's preview origin, so {slug}.localhost:<port> exercises the same hooks
 * as {slug}.corvmc.org in production.
 */
const PORT = E2E_PREVIEW_PORT;
const subdomain = (slug: string) => `http://${slug}.localhost:${PORT}`;
const profilePath = `/directory/bands/${SEED_PUBLIC_BAND_SLUG}`;

test('band addresses route by tier and history', async ({ page, request }) => {
	test.setTimeout(120_000);

	await test.step('the server answers each host without a browser', async () => {
		const free = await request.get(`${subdomain(SEED_PUBLIC_BAND_SLUG)}/`, { maxRedirects: 0 });
		expect.soft(free.status()).toBe(302);
		expect.soft(free.headers()['location']).toContain(profilePath);

		// 302, not 301: the old address is claimable again, so the redirect has to be
		// revocable.
		const old = await request.get(`${subdomain(SEED_PUBLIC_BAND_OLD_SLUG)}/`, {
			maxRedirects: 0
		});
		expect.soft(old.status()).toBe(302);
		expect.soft(old.headers()['location']).toContain(`${SEED_PUBLIC_BAND_SLUG}.localhost:${PORT}`);

		const unrelated = await request.get(
			`http://localhost:${PORT}/api/host-route?host=not-a-band.example.com`
		);
		expect.soft(unrelated.ok()).toBe(true);
		expect.soft(await unrelated.json()).toEqual({ slug: null });
	});

	const bandHeading = page.getByRole('heading', { name: SEED_PUBLIC_BAND_NAME });

	await test.step('a free subdomain ends on the directory profile', async () => {
		const response = await page.goto(`${subdomain(SEED_PUBLIC_BAND_SLUG)}/`);
		expect(response?.status()).toBe(200); // after following the redirect
		expect(page.url()).toContain(profilePath);
		await expect(bandHeading).toBeVisible();
	});

	await test.step('an old subdomain follows both hops to the band', async () => {
		await page.goto(`${subdomain(SEED_PUBLIC_BAND_OLD_SLUG)}/`);
		expect(page.url()).toContain(profilePath);
		await expect(bandHeading).toBeVisible();
	});

	await test.step('an old directory URL forwards to the current one', async () => {
		await page.goto(`http://localhost:${PORT}/directory/bands/${SEED_PUBLIC_BAND_OLD_SLUG}`);
		expect(page.url()).toContain(profilePath);
		await expect(bandHeading).toBeVisible();
	});

	await test.step('a premium subdomain stays put and serves its site', async () => {
		await page.goto(`${subdomain(SEED_PREMIUM_BAND_SLUG)}/`);
		expect(page.url()).toContain(`${SEED_PREMIUM_BAND_SLUG}.localhost`);
		expect(page.url()).not.toContain('/directory/');
		await expect(page).toHaveTitle(new RegExp(SEED_PREMIUM_BAND_NAME));
	});

	// The section, not the <img>: images need R2, which `vite preview` lacks, while the
	// section renders only when the media tables returned a gallery row for this band.
	await test.step('the premium press kit renders gallery media', async () => {
		await page.goto(`${subdomain(SEED_PREMIUM_BAND_SLUG)}/epk`);
		await expect(page.getByTestId('epk-gallery')).toBeVisible();
	});

	// The negative control: no history row, so no forward.
	await test.step('an unknown subdomain ends at a real directory 404', async () => {
		const response = await page.goto(`${subdomain('no-such-band-xyz')}/`);
		expect(page.url()).toContain('/directory/bands/no-such-band-xyz');
		expect(response?.status()).toBe(404);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${response?.status()}`);
	});
});
