import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_PREMIUM_BAND_SLUG } from './fixtures/seed-band-onboarding';

/**
 * The member and band sidebars, which had the same defect the staff one did:
 * `NavItem` matched the pathname exactly, so no row lit up on any detail page.
 * Thirteen member routes and two band routes were dark.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

const nav = (page: Page) => page.locator('aside ul.menu').first();

test.describe('member sidebar', () => {
	test('highlights the section a detail page belongs to', async ({ page }) => {
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
	});

	test('keeps the bottom cluster pinned to the foot of the sidebar', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/member');

		const membership = nav(page).getByRole('link', { name: 'Membership' });
		await expect(membership).toBeVisible();
		// The spacer still does its job now that the list is a scroll container.
		const gap = await nav(page).evaluate((ul) => {
			const list = ul.getBoundingClientRect();
			const last = ul.querySelector('a[href="/member/membership"]')!.getBoundingClientRect();
			return list.bottom - last.bottom;
		});
		expect(gap).toBeLessThan(40);
	});

	test('collapses My Acts and remembers it', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/member');

		const header = nav(page).getByRole('button', { name: 'My Acts' });
		await expect(header).toHaveAttribute('aria-expanded', 'true');
		await expect(nav(page).getByRole('link', { name: 'Create Act' })).toBeVisible();

		await header.click();
		await expect(nav(page).getByRole('link', { name: 'Create Act' })).toHaveCount(0);

		await page.reload();
		await expect(nav(page).getByRole('button', { name: 'My Acts' })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
	});

	test('keeps its collapse record separate from the staff panel', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/member');
		await nav(page).getByRole('button', { name: 'My Acts' }).click();

		await page.goto('/staff');
		// Staff's own groups are untouched by a member-panel preference.
		for (const title of ['People', 'Space', 'Money']) {
			await expect(nav(page).getByRole('button', { name: title })).toHaveAttribute(
				'aria-expanded',
				'true'
			);
		}
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
	});

	test('lights the dashboard only on the band root', async ({ page }) => {
		await loginAsStaff(page);

		await page.goto(band);
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', band);
	});

	test('never marks View Live Site as the active row', async ({ page }) => {
		await loginAsStaff(page);

		await page.goto(`${band}/members`);
		// Its href points at another origin, and an empty href in the data would
		// otherwise be a prefix of every path.
		const active = nav(page).locator('a.active');
		await expect(active).toHaveCount(1);
		await expect(active).toHaveAttribute('href', `${band}/members`);
	});
});
