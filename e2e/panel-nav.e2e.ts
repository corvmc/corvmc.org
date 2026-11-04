import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_PREMIUM_BAND_SLUG } from './fixtures/seed-band-onboarding';

/**
 * The member and band sidebars, which had the same defect the staff one did:
 * `NavItem` matched the pathname exactly, so no row lit up on any detail page.
 * Thirteen member routes and two band routes were dark.
 */

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

const nav = (page: Page) => page.locator('aside ul.menu').first();

const navLink = (page: Page, href: string) => nav(page).locator(`a[href="${href}"]`);

/** The disclosure button of the group holding `href`, hidden or not. */
const groupToggle = (page: Page, href: string) =>
	nav(page)
		.locator('li')
		.filter({ has: page.locator(`a[href="${href}"]`) })
		.locator('button[aria-expanded]');

const BROWSE_BANDS = '/member/directory/bands';

// The member-context rows that moved from the sidebar into the chrome (#1244).
const ACCOUNT_HREFS = [
	'/member/profile',
	'/member/account',
	'/member/purchases',
	'/member/membership'
];

test.describe('member sidebar', () => {
	test('highlights the section a detail page belongs to, and keeps the chrome rows out', async ({
		page
	}) => {
		await loginAsStaff(page);

		await page.goto('/member/reservations');
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', '/member/reservations');

		// A reservation record: exact matching lit nothing here.
		const first = page.locator('a[href^="/member/reservations/"]').first();
		if (await first.count()) {
			await first.click();
			await page.waitForURL(/\/member\/reservations\/.+/);
			await expect(nav(page).locator('a.active')).toHaveCount(1);
			await expect(nav(page).locator('a.active')).toHaveAttribute('href', '/member/reservations');
		}

		// The meta rows stay pinned to the foot of the sidebar.
		await page.goto('/member');

		// Suggestions and Help, since #1244 — the member-context rows that used to
		// end this cluster are in the avatar dropdown now.
		await expect(navLink(page, '/member/help')).toBeVisible();
		// The spacer still does its job now that the list is a scroll container.
		// Polled: the list can still be re-rendering after the navigation (#2306).
		await expect
			.poll(() =>
				nav(page).evaluate((ul) => {
					const help = ul.querySelector('a[href="/member/help"]');
					if (!help) return null;
					return ul.getBoundingClientRect().bottom - help.getBoundingClientRect().bottom;
				})
			)
			.toBeLessThan(40);

		// The member-context rows are out of the sidebar and in the chrome.
		for (const href of ['/member/messages', ...ACCOUNT_HREFS]) {
			await expect(navLink(page, href)).toHaveCount(0);
		}

		// The topbar carries Messages on every panel, which is the point of the
		// move — a band admin reaches their own inbox without switching panels.
		await expect(page.locator('a[aria-label^="Messages"]')).toBeVisible();

		const accountMenu = page.locator('.account-dropdown-wrapper');
		await accountMenu.locator('button').first().click();
		for (const href of ACCOUNT_HREFS) {
			await expect(accountMenu.locator(`a[href="${href}"]`)).toBeVisible();
		}
	});

	test('collapses My Bands, remembers it, and leaves the staff panel alone', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/member');

		const header = groupToggle(page, BROWSE_BANDS);
		await expect(header).toHaveAttribute('aria-expanded', 'true');
		await expect(navLink(page, BROWSE_BANDS)).toBeVisible();

		await header.click();
		await expect(navLink(page, BROWSE_BANDS)).toBeHidden();

		await page.reload();
		await expect(groupToggle(page, BROWSE_BANDS)).toHaveAttribute('aria-expanded', 'false');

		// The collapse record is the member panel's own, not the staff panel's.
		await page.goto('/staff');
		// Staff's own groups are untouched by a member-panel preference.
		await expect(nav(page).locator('button[aria-expanded="true"]').first()).toBeVisible();
		await expect(nav(page).locator('button[aria-expanded="false"]')).toHaveCount(0);
	});
});

test.describe('member sidebar browse rows', () => {
	test('Browse Bands lights alone, and Browse Groups replaces All', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/member');

		await navLink(page, BROWSE_BANDS).click();
		await page.waitForURL('**/member/directory/bands');
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', '/member/directory/bands');

		// The browse rows replaced both headers' "All" links (#2132): one row per
		// address, and nothing left at the bands list.
		await expect(navLink(page, '/member/groups')).toHaveCount(1);
		await expect(navLink(page, '/member/bands')).toHaveCount(0);
	});

	test('the old addresses redirect', async ({ page }) => {
		await loginAsStaff(page);

		await page.goto('/member/directory?tab=bands');
		await expect(page).toHaveURL(/\/member\/directory\/bands$/);

		await page.goto('/member/directory/instructors');
		await expect(page).toHaveURL(/\/member\/directory\?teaches=collective$/);
		await expect(
			page.locator('input:is([name="teachesAtCollective"], [name^="teachesAtCollective/"])')
		).toBeChecked();
	});
});

test.describe('band sidebar', () => {
	// Staff resolve to the pseudo-role 'staff' on a band they don't belong to,
	// which is enough to render the panel — so no band membership is needed here.
	const band = `/band/${SEED_PREMIUM_BAND_SLUG}`;

	test('highlights the section a detail page belongs to', async ({ page }) => {
		await loginAsStaff(page);

		await page.goto(`${band}/events`);
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', `${band}/events`);

		// The regression: a band event record lit no row at all.
		await page.goto(`${band}/events/some-event-id`);
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', `${band}/events`);

		// The dashboard lights only on the band root.
		await page.goto(band);
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', band);

		// View Live Site is never the active row.
		await page.goto(`${band}/members`);
		// Its href points at another origin, and an empty href in the data would
		// otherwise be a prefix of every path.
		const active = nav(page).locator('a.active');
		await expect(active).toHaveCount(1);
		await expect(active).toHaveAttribute('href', `${band}/members`);
	});
});
