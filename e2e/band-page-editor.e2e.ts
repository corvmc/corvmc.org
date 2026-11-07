import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_PREMIUM_BAND_SLUG
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

/** Every block on the page, editor and public alike. */
const blocks = (page: Page) => page.locator('section.band-site-block');

async function login(page: Page) {
	await signInAs(page, { email: SEED_OWNER_EMAIL, password: SEED_OWNER_PASSWORD });
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
	// bring back — and its body gives way to a note on its state.
	const members = blocks(page).filter({ has: page.getByLabel('Publish Members') });
	await expect(members).toBeVisible();
	await expect(members.locator('.editor-chrome').last()).toBeVisible();
	await expect(members.getByRole('heading')).toHaveCount(0);
	await expect(page.getByLabel('Publish Members')).toHaveAttribute('aria-pressed', 'false');

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
	const addShow = blocks(page).locator(
		`a[href="/band/${SEED_PREMIUM_BAND_SLUG}/events"]:not(.strip a)`
	);
	await expect(addShow).toBeVisible();

	// ...and the same band DOES have a member, so that block renders for real
	// rather than being ghosted alongside it: no link out to the roster.
	const members = blocks(page).filter({ has: page.getByLabel('Stop publishing Members') });
	await expect(members.getByRole('heading')).toBeVisible();
	await expect(
		members.locator(`a[href="/band/${SEED_PREMIUM_BAND_SLUG}/members"]:not(.strip a)`)
	).toHaveCount(0);
});

test('the theme control shows what the theme does, read-only until you take it over', async ({
	page
}) => {
	await login(page);
	await page.goto(`/band/${SEED_PREMIUM_BAND_SLUG}/page-editor`);
	await expect(page.getByLabel('Move Hero down')).toBeVisible({ timeout: 15000 });

	// The select that offers the themes, by the values it stores.
	const themeSelect = page.locator('select:has(option[value="punk"])');
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
	await page.getByTestId('fork-theme').click();
	const own = page.getByLabel('Your custom CSS');
	await expect(own).toBeVisible();
	await expect(own).not.toHaveAttribute('readonly', '');
	await expect(own).toHaveValue(/#ff2d55/);
	await expect(themeSelect).toHaveValue('custom');
	// It still says where it came from: the fork's option names the theme.
	const punk = await themeSelect.locator('option[value="punk"]').textContent();
	await expect(themeSelect.locator('option[value="custom"]')).toContainText(punk ?? '');
});
