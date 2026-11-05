import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
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
const PORT = E2E_PREVIEW_PORT;

async function login(page: Page) {
	await signInAs(page, { email: SEED_OWNER_EMAIL, password: SEED_OWNER_PASSWORD });
}

/** The base64url JSON argument of a remote query GET; empty for any other request. */
function remoteQueryArg(url: string): string {
	const { pathname, searchParams } = new URL(url);
	const payload = searchParams.get('payload');
	if (!pathname.includes('/_app/remote/') || !payload) return '';
	return Buffer.from(decodeURIComponent(payload), 'base64url').toString();
}

test('an owner can move their band to a new address', async ({ page, request }, testInfo) => {
	// A failed attempt may already have moved the band, so a retry takes an address
	// of its own. The seeded slug still reaches the band through its forward, and
	// the fixture's rate limit (3) covers all three attempts.
	const NEW_SLUG = `e2e-renamed-band-${testInfo.retry}`;

	await login(page);
	await page.goto(`/band/${SEED_RENAME_BAND_SLUG}/settings`);

	await page.getByTestId('change-address').click();
	const newSlug = page.locator('input:is([name="newSlug"], [name^="newSlug/"])');
	await newSlug.fill(NEW_SLUG);

	// The seeded slug on a first attempt, the previous attempt's on a retry.
	const movedFrom = new URL(page.url()).pathname.split('/')[2];
	const queried: string[] = [];
	page.on('request', (r) => queried.push(remoteQueryArg(r.url())));

	await page.locator('form').filter({ has: newSlug }).locator('button[type="submit"]').click();

	// The mutation refreshes nothing server-side — the client navigates, which is
	// what re-keys every slug-scoped query on the page.
	await page.waitForURL(new RegExp(`/band/${NEW_SLUG}/settings`), { timeout: 15000 });
	await expect(page.getByRole('heading', { name: `${NEW_SLUG}.localhost` })).toBeVisible({
		timeout: 15000
	});

	// Which response arrives first decides whether a refresh of an old-slug query
	// strands the owner on the band root, so assert the refresh rather than a URL
	// that is right most of the time. The first half proves the decoding still works.
	expect(queried.some((arg) => arg.includes(`"${NEW_SLUG}"`))).toBe(true);
	expect(queried.filter((arg) => arg.includes(`"${movedFrom}"`))).toEqual([]);
	await expect(page).toHaveURL(new RegExp(`/band/${NEW_SLUG}/settings`));

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
