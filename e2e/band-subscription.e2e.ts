import { expect, test, type Page } from './fixtures/test';
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

/** A plan's own form, told apart by the interval it posts. */
function planSubmit(page: Page, interval: 'monthly' | 'yearly') {
	return page
		.locator('form')
		.filter({
			has: page.locator(
				`input:is([name="billingInterval"], [name^="billingInterval/"])[value="${interval}"]`
			)
		})
		.locator('button[type="submit"]');
}

async function login(page: Page) {
	await signInAs(page, { email: SEED_OWNER_EMAIL, password: SEED_OWNER_PASSWORD });
}

test('upgrade page renders both plans, and shows the free address, for a free-tier owner', async ({
	page
}) => {
	await login(page);
	await page.goto(`/band/${SEED_PUBLIC_BAND_SLUG}/subscription`);

	await expect(planSubmit(page, 'monthly')).toBeVisible({ timeout: 15000 });
	await expect(planSubmit(page, 'yearly')).toBeVisible();
	// The form-object throw rendered the layout boundary's failed alert instead.
	await expect(page.locator('[data-boundary-failed]')).toHaveCount(0);

	// The band's free address, derived from PUBLIC_SITE_URL rather than a
	// hardcoded corvmc.org, is shown as something they already have.
	await expect(page.getByText(new RegExp(`${SEED_PUBLIC_BAND_SLUG}\\.`)).first()).toBeVisible({
		timeout: 15000
	});
});
