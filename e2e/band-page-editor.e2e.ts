import { expect, test, type Page } from '@playwright/test';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_PREMIUM_BAND_SLUG,
	SEED_PREMIUM_BAND_NAME
} from './fixtures/seed-band-onboarding';

/**
 * The page editor renders the band's actual page with its controls injected
 * into it, rather than a list of block rows above a read-only preview.
 *
 * Three things are worth holding down, because all three were regressions
 * waiting to happen:
 *
 *   1. The controls are in each block's own strip — show/hide included, which is
 *      the one control a band reaches for most and the easiest to bury in a
 *      settings panel.
 *   2. Reordering works by button. Drag-and-drop is the fast path but it cannot
 *      be the only one: no keyboard, no touch-while-scrolling, nothing for a
 *      block taller than the viewport.
 *   3. The PUBLIC page still renders with none of it. One component draws both,
 *      so a leak here would put editor chrome on every band's live site.
 *
 * The style panel's own invariant is the fourth: a theme's CSS is shown, not
 * hidden, and taking it over drops the theme rather than layering on top of it.
 * That is the whole reason the control was rebuilt — see `theme-fork.ts`.
 */

async function login(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_OWNER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_OWNER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/** The block names, top to bottom, as the control strips report them. */
async function blockOrder(page: Page) {
	// `goto` resolves before an awaited remote query commits, so wait for the
	// first strip rather than reading an empty <main>.
	await expect(page.getByLabel('Move Hero down')).toBeVisible({ timeout: 15000 });
	return page
		.locator('[aria-label^="Move "][aria-label$=" down"]')
		.evaluateAll((els) =>
			els.map((el) => (el.getAttribute('aria-label') ?? '').replace(/^Move | down$/g, ''))
		);
}

test('every block carries its own controls, show/hide included', async ({ page }) => {
	await login(page);
	await page.goto(`/band/${SEED_PREMIUM_BAND_SLUG}/page-editor`);

	// The strip, on the block, not a row in a list somewhere else.
	await expect(page.getByLabel('Move Hero down')).toBeVisible({ timeout: 15000 });
	await expect(page.getByLabel('Move Hero up')).toBeVisible();

	// The control this test exists for: publishing is a per-block toggle sitting
	// in the strip, not something you go looking for.
	await expect(page.getByLabel('Stop publishing Hero')).toBeVisible();
	await expect(page.getByLabel('Stop publishing Bio')).toBeVisible();

	// The first block cannot move up and the last cannot move down.
	await expect(page.getByLabel('Move Hero up')).toBeDisabled();
});

test('reorder buttons move a block, not just the drag handle', async ({ page }) => {
	await login(page);
	await page.goto(`/band/${SEED_PREMIUM_BAND_SLUG}/page-editor`);

	const before = await blockOrder(page);
	expect(before.slice(0, 2)).toEqual(['Hero', 'Bio']);

	await page.getByLabel('Move Bio up').click();

	const after = await blockOrder(page);
	expect(after.slice(0, 2)).toEqual(['Bio', 'Hero']);
	// Nothing else moved.
	expect(after.slice(2)).toEqual(before.slice(2));
});

test('hiding a block keeps it in the editor and says it is unpublished', async ({ page }) => {
	await login(page);
	await page.goto(`/band/${SEED_PREMIUM_BAND_SLUG}/page-editor`);

	await expect(page.getByLabel('Stop publishing Members')).toBeVisible({ timeout: 15000 });
	await page.getByLabel('Stop publishing Members').click();

	// The block stays on the page — a block you cannot see is a block you cannot
	// bring back — and says what its state is.
	await expect(
		page.getByText(/Not published\. Whatever you put in this block is kept\./)
	).toBeVisible();
	await expect(page.getByLabel('Publish Members')).toBeVisible();

	await page.getByLabel('Publish Members').click();
	await expect(page.getByLabel('Stop publishing Members')).toBeVisible();
});

test('an empty block shows what it will look like and where to fill it', async ({ page }) => {
	await login(page);
	await page.goto(`/band/${SEED_PREMIUM_BAND_SLUG}/page-editor`);
	await expect(page.getByLabel('Move Hero down')).toBeVisible({ timeout: 15000 });

	// The seeded premium band has no gigs, so the Shows block renders nothing at
	// all on the live site. In the editor it is a ghost that names its action and
	// points at the surface that owns the data.
	const addShow = page.getByRole('link', { name: /Add a show/ });
	await expect(addShow).toBeVisible();
	await expect(addShow).toHaveAttribute('href', `/band/${SEED_PREMIUM_BAND_SLUG}/events`);

	// ...and the same band DOES have a member, so that block renders for real
	// rather than being ghosted alongside it.
	await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Invite your bandmates/ })).toHaveCount(0);
});

test('the public band site renders with none of the editor chrome', async ({ page }) => {
	// No login: this is what a stranger gets.
	await page.goto(`/band-site/${SEED_PREMIUM_BAND_SLUG}`);

	await expect(page.getByText(SEED_PREMIUM_BAND_NAME).first()).toBeVisible({ timeout: 15000 });

	// One component draws both surfaces, so these are the leak detectors.
	await expect(page.getByLabel(/^Move /)).toHaveCount(0);
	await expect(page.getByLabel(/^Stop publishing /)).toHaveCount(0);
	await expect(page.getByText(/Not published/)).toHaveCount(0);
	// An empty block stays empty in public — the ghost is editor-only, so Preview
	// and the live site agree about what actually publishes.
	await expect(page.getByRole('link', { name: /Add a show/ })).toHaveCount(0);
});

test('the theme control shows what the theme does, read-only until you take it over', async ({
	page
}) => {
	await login(page);
	await page.goto(`/band/${SEED_PREMIUM_BAND_SLUG}/page-editor`);
	await expect(page.getByLabel('Move Hero down')).toBeVisible({ timeout: 15000 });

	const themeSelect = page.getByLabel('Theme');
	await expect(themeSelect).toBeVisible();

	// A theme is legible: its actual rules are in the pane, not hidden behind a
	// class the band can only override blindly.
	const pane = page.getByLabel('Theme CSS (read-only)');
	await expect(pane).toHaveValue(/--bs-accent/);
	await expect(pane).toHaveAttribute('readonly', '');

	// Switching themes switches what the pane shows.
	await themeSelect.selectOption('punk');
	await expect(pane).toHaveValue(/#ff2d55/);

	// Taking it over is the fork: the pane becomes the band's, and the theme
	// stops applying — so what they can read is the whole of what applies.
	await page.getByRole('button', { name: 'Customize' }).click();
	const own = page.getByLabel('Your custom CSS');
	await expect(own).toBeVisible();
	await expect(own).not.toHaveAttribute('readonly', '');
	await expect(own).toHaveValue(/#ff2d55/);
	await expect(themeSelect).toHaveValue('custom');
	// It still says where it came from.
	await expect(page.getByRole('option', { name: 'Custom (from Punk)' })).toBeAttached();
});

test('the hero block carries its own upload, not a Media section at the foot of the page', async ({
	page
}) => {
	await login(page);
	await page.goto(`/band/${SEED_PREMIUM_BAND_SLUG}/page-editor`);
	await expect(page.getByLabel('Move Hero down')).toBeVisible({ timeout: 15000 });

	// The page-level Media card and the EPK button are gone; the sidebar already
	// links to the press kit, and an upload belongs to the block that shows it.
	await expect(page.getByRole('link', { name: 'Edit EPK' })).toHaveCount(0);
	await expect(page.getByText('Gallery images')).toHaveCount(0);

	await page.getByLabel('Hero settings').click();
	await expect(page.getByText('Hero image')).toBeVisible();
});
