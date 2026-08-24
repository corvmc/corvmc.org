import { expect, test } from '@playwright/test';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_PUBLIC_BAND_SLUG,
	SEED_PUBLIC_BAND_HOMETOWN,
	SEED_PUBLIC_BAND_FOUNDED,
	SEED_HIDDEN_BAND_SLUG,
	SEED_MEMBERS_BAND_SLUG,
	SEED_MEMBERS_BAND_NAME,
	SEED_RETITLE_BAND_SLUG
} from './fixtures/seed-band-onboarding';

/**
 * Regression tests for the band directory onboarding flow.
 *
 * 1. The band profile edit page (/band/[slug]/edit) crashed on load with
 *    Svelte's effect_update_depth_exceeded — the same async-page-script bug
 *    fixed for /member/profile in 7a1ceed but never applied to the band pages —
 *    so the "enrich your profile" onboarding step was unusable.
 * 2. The edit form rendered no hometown/foundedYear inputs, so every save
 *    silently nulled both columns (they render on the public profile).
 * 3. Band detail pages ignored band.directoryVisibility: hidden/members bands
 *    disappeared from directory listings but stayed fully readable at their
 *    public URL, logged-out.
 * 4. The sidebar "Create Band" nav link pointed at /member/bands/create,
 *    which does not exist (404); the create modal lives on /member/bands.
 */

/**
 * The `<dd>` of a QuickFacts row on a public profile page. Scoped deliberately:
 * a bare `getByText('Corvallis, OR')` also matches the site footer's 501(c)(3)
 * address, so a page-wide locator either reads the wrong element or trips
 * strict mode once the profile server-renders.
 */
function quickFact(page: import('@playwright/test').Page, label: string) {
	return page
		.locator('.quick-fact')
		.filter({ has: page.getByText(label, { exact: true }) })
		.locator('dd');
}

async function login(page: import('@playwright/test').Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_OWNER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_OWNER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('band profile edit page renders the form for an owner', async ({ page }) => {
	await login(page);
	await page.goto(`/band/${SEED_PUBLIC_BAND_SLUG}/edit`);

	// The regression rendered a "Failed to load: effect_update_depth_exceeded"
	// banner instead of the form.
	await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(/failed to load/i)).toHaveCount(0);

	// The profile fields the public page displays are all editable — hometown
	// and foundedYear were missing entirely, which wiped them on save.
	await expect(page.locator('input[name="hometown"]')).toHaveValue(SEED_PUBLIC_BAND_HOMETOWN);
	await expect(page.locator('input[name="foundedYear"]')).toHaveValue(SEED_PUBLIC_BAND_FOUNDED);
});

test('saving the profile preserves hometown and founded year', async ({ page }) => {
	await login(page);
	await page.goto(`/band/${SEED_PUBLIC_BAND_SLUG}/edit`);
	await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15000 });

	// Dirty the form so the submit is a real save, then save.
	await page.locator('input[name="tagline"]').fill('E2E save round-trip');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Profile saved')).toBeVisible({ timeout: 15000 });

	// The public profile still shows "Based in {hometown}" / "Formed {year}".
	await page.goto(`/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);
	await expect(quickFact(page, 'Based in')).toHaveText(SEED_PUBLIC_BAND_HOMETOWN);
	await expect(quickFact(page, 'Formed')).toHaveText(SEED_PUBLIC_BAND_FOUNDED);
});

// Public pages server-render their remote queries (the (public) layout's
// boundary has no pending snippet), so the visibility gate is a real HTTP 404
// carrying SvelteKit's +error.svelte — not a 200 shell that resolves the gate
// client-side. Either way no profile content is rendered.
test('hidden band detail page is not publicly readable', async ({ page }) => {
	await page.goto(`/directory/bands/${SEED_HIDDEN_BAND_SLUG}`);
	// .first(): the message is also embedded in the serialized __sveltekit payload.
	await expect(page.getByText('Band not found').first()).toBeVisible({ timeout: 15000 });
	await expect(page.getByText('E2E Hidden Band')).toHaveCount(0);
	await expect(page.getByText('opted out of the directory')).toHaveCount(0);
});

test('members-only band is withheld publicly but renders in the member directory', async ({
	page
}) => {
	await page.goto(`/directory/bands/${SEED_MEMBERS_BAND_SLUG}`);
	// .first(): the message is also embedded in the serialized __sveltekit payload.
	await expect(page.getByText('Band not found').first()).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(SEED_MEMBERS_BAND_NAME)).toHaveCount(0);

	await login(page);
	await page.goto(`/member/directory/bands/${SEED_MEMBERS_BAND_SLUG}`);
	await expect(page.getByText(SEED_MEMBERS_BAND_NAME).first()).toBeVisible({ timeout: 15000 });
});

// Regression (JAVASCRIPT-SVELTEKIT-24): renaming a band used to rotate its slug,
// but saveBandProfile then refreshed getBandProfile, which re-resolves the band
// from `params.slug` — still the pre-rename value, because for a remote request
// it comes from the `x-sveltekit-pathname` header the client sent. The lookup
// 404s, SvelteKit ships that per-query failure to the client, and
// `apply_refreshes` calls `resource.fail(...)`: the save succeeded and the page
// it had just saved dropped into a "Band not found" state.
//
// The hazard was removed at the source — a rename no longer touches the slug at
// all, because that slug is the band's public address (owners change it
// deliberately on the settings page; see band-address.e2e.ts). So the page now
// stays put, which is the other half of what this test guards: a rename must not
// move a band's URL out from under anyone.
//
// Renames a band that exists to be renamed (SEED_RETITLE_BAND_*) and leaves it
// renamed. This used to borrow the public band and put the name back at the end,
// which coupled it to every later spec that keys off SEED_PUBLIC_BAND_NAME: the
// restore was confirmed by a `Profile saved` toast that was often still the
// *first* save's, so the assertion passed instantly and the test could finish
// with the restore in flight. Playwright then closed the page, the request was
// cut off, the band stayed renamed, and three `band-subdomain.e2e.ts` tests
// failed several files later for a reason nothing in them could explain. The
// fixture recreates its bands every run, so there is nothing to put back.
test('renaming a band saves cleanly and leaves its address alone', async ({ page }) => {
	const consoleErrors: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') consoleErrors.push(m.text());
	});

	const NEW_NAME = 'E2E Renamed Band';

	await login(page);
	await page.goto(`/band/${SEED_RETITLE_BAND_SLUG}/edit`);
	await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15000 });

	await page.locator('input[name="name"]').fill(NEW_NAME);
	await page.getByRole('button', { name: 'Save' }).click();

	await expect(page.getByText('Profile saved')).toBeVisible({ timeout: 15000 });
	// The save worked, so nothing on the page may claim the band is missing.
	await expect(page.getByText('Band not found')).toHaveCount(0);
	// Same URL as before the rename — no slug rotation, nothing to follow.
	await expect(page).toHaveURL(new RegExp(`/band/${SEED_RETITLE_BAND_SLUG}/edit`));

	// The reported failure was a caught exception: the form swallowed it into a
	// toast and only the console (and Sentry) showed the real cause.
	expect(consoleErrors.join('\n')).not.toContain('JSON.parse');

	// The toast says the response came back; a reload says the row moved. Worth
	// the extra load: a save that toasts without landing is exactly what made the
	// old restore step unreliable.
	await page.reload();
	await expect(page.locator('input[name="name"]')).toHaveValue(NEW_NAME, { timeout: 15000 });
});

test('the sidebar Create Band link opens the create-band modal', async ({ page }) => {
	await login(page);

	// The nav entry pointed at /member/bands/create, a 404; it must point at
	// the bands page with the create param instead. (There used to be a second,
	// icon-only copy in the Bands group header; that header now carries an
	// "All" link to /member/bands instead.)
	const createLink = page.getByRole('link', { name: 'Create Band' });
	await expect(createLink).toHaveAttribute('href', '/member/bands?create=1');

	// Clicking the link (immediately after login, while the layout's async
	// queries are still settling) opens the create-band modal. The link carries
	// data-sveltekit-reload because a client-side navigation in that window can
	// leave the modal permanently unmounted — a svelte experimental-async
	// scheduling gap still present in 5.56.8; e2e/create-band-modal.e2e.ts
	// covers the related client-side-nav + button regression.
	await createLink.click();
	await page.waitForURL(/\/member\/bands\?create=1/, { timeout: 15000 });
	await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
	await expect(page.getByRole('dialog').locator('input[name="name"]')).toBeVisible();
});
