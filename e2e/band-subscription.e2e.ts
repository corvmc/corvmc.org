import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_PUBLIC_BAND_SLUG
} from './fixtures/seed-band-onboarding';

/**
 * Regression test for the band premium upgrade page.
 *
 * /band/[slug]/subscription renders two <form> elements for a free-tier band —
 * Subscribe Monthly and Subscribe Yearly — and both were spread with the SAME
 * `upgradeToPremium` form object. SvelteKit allows a form object on one element
 * only, so the page threw "A form object can only be attached to a single
 * `<form>` element" and rendered a "Failed to load" banner instead of the
 * plans. Every band's only self-serve path to premium (and therefore to a
 * {slug}.corvmc.org site) was dead. Fixed with `.for('monthly')`/`.for('yearly')`.
 *
 * The seeded bands are free tier, which is exactly the branch that broke.
 */

async function login(page: Page) {
	await signInAs(page, { email: SEED_OWNER_EMAIL, password: SEED_OWNER_PASSWORD });
}

test('upgrade page renders both plans, and sells a custom domain, for a free-tier owner', async ({
	page
}) => {
	await login(page);
	await page.goto(`/band/${SEED_PUBLIC_BAND_SLUG}/subscription`);

	await expect(page.getByRole('button', { name: 'Subscribe Monthly' })).toBeVisible({
		timeout: 15000
	});
	await expect(page.getByRole('button', { name: 'Subscribe Yearly' })).toBeVisible();
	await expect(page.getByText(/failed to load/i)).toHaveCount(0);
	await expect(page.getByText(/single `<form>` element/i)).toHaveCount(0);

	// The band's free address, derived from PUBLIC_SITE_URL rather than a
	// hardcoded corvmc.org, is shown as something they already have.
	await expect(page.getByText(new RegExp(`${SEED_PUBLIC_BAND_SLUG}\\.`)).first()).toBeVisible({
		timeout: 15000
	});

	// Subdomains became free for every band, so premium must not still be
	// advertising one as the thing you are paying for.
	await expect(page.getByText(/custom subdomain/i)).toHaveCount(0);
	await expect(page.getByText(/your own domain/i).first()).toBeVisible();
});
