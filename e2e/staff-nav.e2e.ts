import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD, SEED_TARGET_ID } from './fixtures/seed-staff-user';

/**
 * The staff sidebar's structure, which nothing else pins.
 *
 * It grew to roughly nineteen rows in one flat `menu` with no overflow of its
 * own, so the list spilled into daisyUI's `.drawer-side` scroller and took the
 * brand and the mobile panel switcher with it. The fix regrouped the rows into
 * collapsible sections and made the list scroll on its own, which introduces
 * three things worth guarding:
 *
 *  - groups render open, so every link stays in the accessibility tree for the
 *    role-based selectors the rest of this suite uses;
 *  - the nav is the scroller, not the drawer, so the brand stays put;
 *  - exactly one row highlights, including on detail pages, where the old
 *    exact-pathname match highlighted nothing at all.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

const nav = (page: Page) => page.locator('aside ul.menu').first();

/**
 * Collapse a group, tolerating the window before hydration.
 *
 * The sidebar is server-rendered, so the disclosure button is present and
 * clickable before Svelte has attached `onclick`. A click in that window is
 * simply lost, the group stays open, and the `toHaveCount(0)` that follows
 * waits out its timeout against a total that will never change. This is the
 * same race `ticket-purchase.e2e.ts` documents at length, and the reason this
 * test failed intermittently on main rather than every time: whether hydration
 * wins depends on whether the browser already has the page's modules cached.
 *
 * Retrying is only safe because the state is re-read before each attempt —
 * `toggle()` flips, so a blind second click would re-open the group it just
 * closed. `aria-expanded` is the same state the assertions below are about to
 * read, so this cannot pass while the click is still being lost.
 */
async function collapseGroup(page: Page, title: string) {
	const button = nav(page).getByRole('button', { name: title });
	await expect(async () => {
		if ((await button.getAttribute('aria-expanded')) === 'true') await button.click();
		expect(await button.getAttribute('aria-expanded')).toBe('false');
	}).toPass({ timeout: 15000 });
}

test.describe('staff sidebar', () => {
	test('shows every group open on a first visit', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff');

		for (const title of [
			'People',
			'Space',
			'Events',
			'Moderation',
			'Outreach',
			'Money',
			'System'
		]) {
			await expect(nav(page).getByRole('button', { name: title })).toHaveAttribute(
				'aria-expanded',
				'true'
			);
		}

		// A row from each of the far ends of the list, both reachable by role.
		await expect(nav(page).getByRole('link', { name: 'Users' })).toBeVisible();
		await expect(nav(page).getByRole('link', { name: 'Settings' })).toBeVisible();
	});

	test('collapses a group and remembers it across a reload', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff');

		await collapseGroup(page, 'Money');
		await expect(nav(page).getByRole('link', { name: 'Payments' })).toHaveCount(0);

		await page.reload();

		await expect(nav(page).getByRole('button', { name: 'Money' })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		await expect(nav(page).getByRole('link', { name: 'Payments' })).toHaveCount(0);
	});

	test('opens a collapsed group when you navigate into it', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff');
		await collapseGroup(page, 'Money');
		await expect(nav(page).getByRole('link', { name: 'Payments' })).toHaveCount(0);

		await page.goto('/staff/payments');

		// A highlighted row you cannot see is worse than no highlight at all.
		await expect(nav(page).getByRole('button', { name: 'Money' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		await expect(nav(page).getByRole('link', { name: 'Payments' })).toBeVisible();
	});

	test('highlights exactly one row, including on a detail page', async ({ page }) => {
		await loginAsStaff(page);

		await page.goto('/staff/users');
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', '/staff/users');

		// The regression: exact-pathname matching lit no row on any `[id]` route.
		await page.goto(`/staff/users/${SEED_TARGET_ID}`);
		await expect(nav(page).locator('a.active')).toHaveCount(1);
		await expect(nav(page).locator('a.active')).toHaveAttribute('href', '/staff/users');
	});

	test('scrolls the nav itself, leaving the brand pinned', async ({ page }) => {
		await loginAsStaff(page);
		// Short enough, on a page whose collapsible is expanded, that the list
		// cannot fit however it is laid out.
		await page.setViewportSize({ width: 1280, height: 400 });
		await page.goto('/staff/volunteer');

		const list = nav(page);
		await expect(list).toBeVisible();

		// daisyUI's `.menu` is `flex-flow: column wrap`, so a height-constrained
		// list wraps into a second column past the 16rem edge and is clipped away
		// instead of scrolling. `flex-nowrap` is what keeps this true.
		const box = await list.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
		expect(box.scroll).toBeGreaterThan(box.client);

		// And the overflow stops here rather than reaching the drawer.
		const drawerScrolls = await page
			.locator('.drawer-side')
			.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
		expect(drawerScrolls).toBe(false);

		const brand = page.locator('aside img[alt="CorvMC"]');
		const before = await brand.boundingBox();
		await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
		const after = await brand.boundingBox();

		// The drawer is not the scroller any more, so the logo does not move.
		expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
		// And the list really did scroll.
		expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	});
});
