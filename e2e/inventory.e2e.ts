import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_ASSET_ID,
	SEED_ASSET_TAG,
	SEED_CONSUMABLE_ID,
	SEED_CONSUMABLE_NAME,
	SEED_CONSUMABLE_RECEIVED,
	SEED_ITEM_ID,
	SEED_ITEM_NAME,
	SEED_UNTAGGED_ASSET_ID
} from './fixtures/seed-inventory';

/**
 * End-to-end coverage for the inventory rebuild (#281).
 *
 * The thing worth pinning here is the **invariant**, not the screens: on-hand is
 * the sum of `stock_movement` and is never stored anywhere, so a run that
 * consumes stock and then corrects it has to land back on a number nobody wrote
 * down. The predecessor kept a hand-maintained `totalQuantity` integer, which is
 * precisely the bug this replaces — and a unit test with a mocked `db` cannot
 * tell the difference between summing a ledger and reading a column.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/**
 * The on-hand figure as the staff item page reports it.
 *
 * Located by the `<dt>` text and its sibling `<dd>` rather than by the `term`
 * role: `DefinitionList` renders dt/dd as bare siblings with no wrapper, so the
 * pair has no shared accessible name to match on.
 */
async function readOnHand(page: Page, itemId: string): Promise<number> {
	await page.goto(`/staff/inventory/${itemId}`);
	const term = page.locator('dt').filter({ hasText: /^On hand$/ });
	await expect(term).toBeVisible();
	// The value cell can carry a "(reorder at N)" hint after the number.
	const value = await term.locator('xpath=following-sibling::dd[1]').innerText();
	return parseInt(value.trim(), 10);
}

/** The submit inside an open Action modal, as distinct from the trigger. */
function modalSubmit(page: Page, name: RegExp) {
	return page.getByRole('dialog').getByRole('button', { name });
}

test.describe('inventory', () => {
	test('the item list shows both kinds and their stock', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inventory');

		await expect(page).toHaveURL(/\/staff\/inventory/);
		await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
		await expect(page.getByRole('table')).toBeVisible();

		await page.locator('input[type="search"], input[name="search"]').first().fill('E2E Test');
		await expect(page.getByText(SEED_ITEM_NAME)).toBeVisible({ timeout: 10000 });
		await expect(page.getByText(SEED_CONSUMABLE_NAME)).toBeVisible();
	});

	test('a serialized item lists its units, tagged and not', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inventory/${SEED_ITEM_ID}`);

		await expect(page.getByRole('heading', { name: SEED_ITEM_NAME })).toBeVisible();
		await expect(page.getByText(SEED_ASSET_TAG)).toBeVisible();
		// Gear is entered before the roll of stickers arrives, so an unbound unit
		// is a normal state the UI has to state rather than hide.
		await expect(page.getByText('Untagged')).toBeVisible();
	});

	/**
	 * The core invariant. Consume, then correct by the same amount, and on-hand
	 * must return to where it started — with both steps visible in the ledger
	 * rather than a total having been overwritten.
	 */
	test('on-hand is the sum of the ledger, not a stored number', async ({ page }) => {
		await loginAsStaff(page);

		const before = await readOnHand(page, SEED_CONSUMABLE_ID);
		expect(before).toBe(SEED_CONSUMABLE_RECEIVED);

		// Use three packs.
		await page.getByRole('button', { name: 'Use' }).click();
		await page.getByRole('dialog').locator('input[name$="quantity"]').fill('3');
		await modalSubmit(page, /^Use$/).click();
		await expect(page.getByText('Recorded')).toBeVisible({ timeout: 10000 });

		const afterUse = await readOnHand(page, SEED_CONSUMABLE_ID);
		expect(afterUse).toBe(before - 3);

		// Put them back with a stocktake correction — the one caller-signed reason.
		await page.getByRole('button', { name: 'Stocktake' }).click();
		await page.getByRole('dialog').locator('input[name$="delta"]').fill('3');
		await modalSubmit(page, /^Stocktake$/).click();
		await expect(page.getByText('Correction recorded')).toBeVisible({ timeout: 10000 });

		const afterCorrection = await readOnHand(page, SEED_CONSUMABLE_ID);
		expect(afterCorrection).toBe(before);

		// Both steps survive as history. Overwriting a total would have left none.
		await expect(page.getByText('Used')).toBeVisible();
		await expect(page.getByText('Adjusted')).toBeVisible();
	});

	test('binding a tag keeps the unit, and its history, intact', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inventory/assets/${SEED_UNTAGGED_ASSET_ID}`);

		await expect(page.getByRole('heading', { name: 'Untagged unit' })).toBeVisible();

		await page.getByRole('button', { name: 'Bind tag' }).click();
		await page.getByRole('dialog').locator('input[name$="assetTag"]').fill('E2E-000099');
		await modalSubmit(page, /^Bind tag$/).click();
		await expect(page.getByText('Tag bound')).toBeVisible({ timeout: 10000 });

		// Same record, new label — identity is the row, never the sticker.
		await expect(page).toHaveURL(new RegExp(SEED_UNTAGGED_ASSET_ID));
		await expect(page.getByRole('heading', { name: 'E2E-000099' })).toBeVisible();
	});

	test.describe('scanning a tag', () => {
		test('sends staff to the operational record', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto(`/a/${SEED_ASSET_TAG}`);

			await expect(page).toHaveURL(`/staff/inventory/assets/${SEED_ASSET_ID}`, {
				timeout: 10000
			});
		});

		/**
		 * A tag is a physical object in a room full of people who may not be
		 * signed in on their phone, so this is the common path rather than an
		 * edge case — and it has to answer with a login, not a 404.
		 */
		test('sends a signed-out scan to the login, not a dead end', async ({ page }) => {
			await page.goto(`/a/${SEED_ASSET_TAG}`);
			// The tag itself is percent-encoded, but it contains nothing that needs
			// escaping, so the path survives verbatim in the query string.
			await expect(page).toHaveURL(`/login?redirectTo=/a/${SEED_ASSET_TAG}`, {
				timeout: 10000
			});
		});

		test('404s on a tag no gear carries', async ({ page }) => {
			await loginAsStaff(page);
			const response = await page.goto('/a/NOT-A-REAL-TAG');
			expect(response?.status()).toBe(404);
		});
	});
});
