import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { eq } from 'drizzle-orm';
import { expectSuccessToast } from './toast';
import { readLocalDb } from './fixtures/platform-db';
import { purchaseOrder, purchaseOrderLine } from '../src/lib/server/db/schema/inventory';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_ORDER_ITEM_ID,
	SEED_ORDER_ITEM_NAME,
	SEED_ORDER_ITEM_REORDER_QUANTITY,
	SEED_ORDER_SUPPLIER
} from './fixtures/seed-inventory';

/**
 * Purchase orders, end to end: Mark as ordered on the restock view writes a
 * placed order, the row shows it coming, and a partial receipt leaves it open.
 * It mutates `SEED_ORDER_ITEM_*`, which nothing else asserts on.
 */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('purchase orders', () => {
	/**
	 * One workflow, one test: ordering the item changes what the restock view asks
	 * for, so a second test starting from "pick the low item" would find it covered.
	 */
	test('an order suppresses the restock ask and survives a partial delivery', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/inventory?show=restock');

		const row = page.getByRole('row').filter({ hasText: SEED_ORDER_ITEM_NAME });
		await expect(row).toContainText(String(SEED_ORDER_ITEM_REORDER_QUANTITY));

		await row.locator('input[type="checkbox"]').check();
		await page.locator('input[name$="expectedAt"]').fill('2099-01-01');
		await page.locator('input[name$="supplierName"]').fill(SEED_ORDER_SUPPLIER);
		// The sticky bar's form, by the hidden payload only it carries.
		const orderForm = page.locator('form', { has: page.locator('input[name="lines"]') });
		await orderForm.locator('button[type="submit"]').click();
		await expectSuccessToast(page);

		// Mark as ordered writes the order already placed: there is no draft step (#2022).
		const readOrder = () =>
			readLocalDb((db) =>
				db.select().from(purchaseOrder).where(eq(purchaseOrder.supplierName, SEED_ORDER_SUPPLIER))
			);
		await expect.poll(async () => (await readOrder())[0]?.status, DB_POLL).toBe('placed');
		const [order] = await readOrder();
		const orderId = order.id;

		const lines = await readLocalDb((db) =>
			db.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, orderId))
		);
		expect(lines).toHaveLength(1);
		expect(lines[0].itemId).toBe(SEED_ORDER_ITEM_ID);
		expect(lines[0].quantityOrdered).toBe(SEED_ORDER_ITEM_REORDER_QUANTITY);

		// Still at or below its point, so still listed — but no longer asked for.
		await page.goto('/staff/inventory?show=restock');
		// Columns: item, on hand, reorder at, buy, on order.
		const afterCells = page
			.getByRole('row')
			.filter({ hasText: SEED_ORDER_ITEM_NAME })
			.getByRole('cell');
		await expect(afterCells.nth(4)).toContainText(String(SEED_ORDER_ITEM_REORDER_QUANTITY));
		await expect(afterCells.nth(3)).not.toContainText(String(SEED_ORDER_ITEM_REORDER_QUANTITY));

		// Receive fewer than were ordered — the case a boolean cannot express.
		await page.goto(`/staff/inventory/orders/${orderId}`);
		await page.locator(`a[href="/staff/inventory/intake?order=${orderId}"]`).click();
		await page.waitForURL(/\/staff\/inventory\/intake\?order=/, { timeout: 15000 });
		// Intake in order mode: the arrival is posted against this order.
		await expect(page.locator('input[name="purchaseOrderId"]')).toHaveValue(orderId);

		const qty = page.locator('input[name="lineQty_0"]');
		await expect(qty).toHaveValue(String(SEED_ORDER_ITEM_REORDER_QUANTITY));
		await qty.fill('5');

		await page
			.locator('form', { has: page.locator('input[name="lines"]') })
			.locator('button[type="submit"]')
			.click();
		await expectSuccessToast(page);

		const readLine = async () => {
			const [line] = await readLocalDb((db) =>
				db.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, orderId))
			);
			return line?.quantityReceived;
		};
		await expect.poll(readLine, DB_POLL).toBe(5);

		const [after] = await readLocalDb((db) =>
			db.select().from(purchaseOrder).where(eq(purchaseOrder.id, orderId))
		);
		expect(after.status).toBe('placed');
	});
});
