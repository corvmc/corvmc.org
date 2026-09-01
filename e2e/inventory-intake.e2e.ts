import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { expectSuccessToast } from './toast';
import { readLocalDb } from './fixtures/platform-db';
import { acquisition, stockMovement } from '../src/lib/server/db/schema/inventory';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_ITEM_ID, SEED_INTAKE_BULK_ID } from './fixtures/seed-inventory';

/**
 * Intake and tagging — the two surfaces a stocktake actually lives in.
 *
 * What the unit tests already prove: that `recordAcquisitionBulk` batches, caps
 * its statements and rejects duplicate tags. What they cannot prove is that the
 * *page* hands it a payload it understands — the lines ride as one hidden JSON
 * field, so a mistake there fails at parse time with nothing on screen, which
 * is exactly the shape of bug an e2e catches and a unit test does not.
 */

/** Marks the unit this file creates, so the tagging test binds that one. */
const INTAKE_SERIAL = 'E2E-INTAKE-SERIAL-1';

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('inventory intake', () => {
	test('an arrival lands whole, and its untagged unit works through the queue', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/inventory/intake');
		await expect(page.getByRole('heading', { name: 'Intake' })).toBeVisible();

		// Line 1: the serialized item, two units, one tagged and one not — the
		// mixed case the tagging queue exists for.
		// By id: the option label is "Category → Item", so it is not the item name
		// on its own, and the id is what the payload carries anyway.
		await page.locator('select[name="lineItem_0"]').selectOption(SEED_ITEM_ID);
		await page.locator('input[name="lineQty_0"]').fill('2');
		await page.locator('input[name="lineCost_0"]').fill('25.00');

		await expect(page.locator('input[name="unitTag_0_0"]')).toBeVisible();
		await page.locator('input[name="unitTag_0_0"]').fill('E2E-INTAKE-1');
		// Second unit deliberately left untagged, but given a serial — that serial
		// is how the tagging test below finds *this* unit rather than binding
		// whatever happens to be first in a queue it shares with the fixtures.
		await page.locator('input[name="unitSerial_0_1"]').fill(INTAKE_SERIAL);

		// Line 2: a counted item, which must not expand into units.
		await page.getByRole('button', { name: 'Add a line' }).click();
		// Its own fixture item, not a shared consumable: `inventory.e2e.ts` asserts
		// those on-hand numbers absolutely, so receiving into one turns a
		// neighbouring test red for a reason unrelated to what it checks.
		await page.locator('select[name="lineItem_1"]').selectOption(SEED_INTAKE_BULK_ID);
		await page.locator('input[name="lineQty_1"]').fill('12');
		await expect(page.locator('input[name="unitTag_1_0"]')).toHaveCount(0);

		await expect(page.getByText('1 will need tagging')).toBeVisible();

		await page.getByRole('button', { name: 'Record this arrival' }).click();
		await expectSuccessToast(page);

		// It lands on the acquisition it just wrote.
		await page.waitForURL(/\/staff\/inventory\/acquisitions\/[0-9a-f-]{36}/, { timeout: 15000 });
		const acquisitionId = page.url().split('/').pop()!;

		// The ledger is the assertion that matters: two `receive` rows for the
		// serialized units and one for the counted line, summing to 14.
		const movements = await readLocalDb((db) =>
			db.select().from(stockMovement).where(eq(stockMovement.acquisitionId, acquisitionId))
		);
		expect(movements).toHaveLength(3);
		expect(movements.reduce((n, m) => n + m.quantity, 0)).toBe(14);

		const [header] = await readLocalDb((db) =>
			db.select().from(acquisition).where(eq(acquisition.id, acquisitionId))
		);
		expect(header.kind).toBe('opening_balance');

		// --- and now the unit it left untagged, through the queue ---
		//
		// One test rather than two: the untagged unit *is* the output of the
		// intake above, so a separate test would either depend on this one having
		// run — the order-dependence `seed-inventory.ts` warns about — or bind
		// whichever fixture unit sorted first, which another test needs untagged.
		await page.goto('/staff/inventory/tagging');
		await expect(page.getByRole('heading', { name: 'Needs tagging' })).toBeVisible();

		const rows = page.locator('input[name$="assetTag"]');
		const before = await rows.count();
		expect(before).toBeGreaterThan(0);

		// The card for the unit the intake test created, found by its serial —
		// binding `.first()` would consume whichever fixture unit happens to sort
		// first, which another test needs untagged.
		const card = page
			.locator('div')
			.filter({ hasText: INTAKE_SERIAL })
			.filter({ has: page.locator('input[name$="assetTag"]') })
			.last();

		await card.locator('input[name$="assetTag"]').fill('E2E-TAGGED-1');
		await card.getByRole('button', { name: 'Bind' }).click();
		await expectSuccessToast(page);

		// The queue is derived from `asset_tag IS NULL`, so the row it just
		// tagged has to be gone without anything invalidating a cache by hand.
		await expect(rows).toHaveCount(before - 1);
	});
});
