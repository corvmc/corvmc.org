import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { readLocalDb } from './fixtures/platform-db';
import { inventoryAsset, stockMovement } from '../src/lib/server/db/schema/inventory';
import { contractorJob } from '../src/lib/server/db/schema/contractor';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_CONTRACTOR_NAME,
	SEED_SERVICE_ASSET_ID,
	SEED_SERVICE_ASSET_TAG
} from './fixtures/seed-contractors';

/**
 * Contractor work, end to end.
 *
 * The claim being proved is the one no unit test can make: the job row and the
 * asset's stock ledger are two records of one event, and driving a unit out to
 * a contractor and back has to leave both agreeing. The services mock `db`, so
 * they can prove `setAssetStatus` was *called* — only this can prove the
 * movements landed.
 */

/** The submit inside an open Action modal, as distinct from the trigger. */
function modalSubmit(page: Page, name: RegExp) {
	return page.getByRole('dialog').getByRole('button', { name });
}

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/** The unit's status and every movement against it, read straight off the file. */
async function assetState() {
	const [asset] = await readLocalDb((db) =>
		db
			.select({ status: inventoryAsset.status })
			.from(inventoryAsset)
			.where(eq(inventoryAsset.id, SEED_SERVICE_ASSET_ID))
	);
	const movements = await readLocalDb((db) =>
		db
			.select({ reason: stockMovement.reason, quantity: stockMovement.quantity })
			.from(stockMovement)
			.where(eq(stockMovement.assetId, SEED_SERVICE_ASSET_ID))
	);
	return { status: asset?.status ?? null, movements };
}

test.describe('contractor jobs', () => {
	/**
	 * One workflow, one test, on purpose: the states are sequential — a job
	 * cannot be completed before it is scheduled — so splitting them would mean
	 * each test rebuilding the state the last one left.
	 */
	test('a repair takes the unit out of service and brings it back', async ({ page }) => {
		await loginAsStaff(page);

		// The unit starts in service, with nothing against it.
		const before = await assetState();
		expect(before.status).toBe('in_service');

		// Open a job against the unit.
		await page.goto('/staff/contractors/jobs');
		await expect(page.getByRole('heading', { name: 'Contractor jobs' })).toBeVisible();

		await page.getByRole('button', { name: 'New job' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('select').first().selectOption({ label: SEED_CONTRACTOR_NAME });
		await dialog.locator('input[name$="summary"]').fill('Retube the E2E amp');
		await dialog.locator('input[name$="assetId"]').fill(SEED_SERVICE_ASSET_ID);
		await modalSubmit(page, /^New job$/).click();

		const jobRow = page.getByRole('row').filter({ hasText: 'Retube the E2E amp' });
		await expect(jobRow).toBeVisible({ timeout: 15000 });

		// Opening a job is not sending the unit anywhere — the ledger must be
		// untouched until it is actually scheduled.
		expect((await assetState()).status).toBe('in_service');

		// Schedule it: this is what takes the unit out of service.
		await jobRow.getByRole('link', { name: 'Retube the E2E amp' }).click();
		await page.getByRole('button', { name: 'Schedule', exact: true }).click();
		await modalSubmit(page, /^Schedule$/).click();

		// Polling the status and then reading the movement in the next statement is
		// only sound because `setAssetStatus` commits both in one `db.batch`. It
		// wrote them as two awaits once, and this pair of lines raced the gap —
		// green on main, red in the merge queue.
		await expect
			.poll(async () => (await assetState()).status, { timeout: 15000 })
			.toBe('maintenance');
		expect((await assetState()).movements.filter((m) => m.reason === 'repair_out')).toHaveLength(1);

		// Complete it: back in service, and the ledger nets out.
		await page.getByRole('button', { name: 'Complete', exact: true }).click();
		await modalSubmit(page, /^Complete$/).click();

		await expect
			.poll(async () => (await assetState()).status, { timeout: 15000 })
			.toBe('in_service');

		const after = await assetState();
		expect(after.movements.filter((m) => m.reason === 'repair_out')).toHaveLength(1);
		expect(after.movements.filter((m) => m.reason === 'repair_in')).toHaveLength(1);
		// The two cancel: a unit that went out and came back is neither added to
		// nor taken from stock on balance.
		expect(after.movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(0);

		const [job] = await readLocalDb((db) =>
			db
				.select({ status: contractorJob.status, assetId: contractorJob.assetId })
				.from(contractorJob)
				.where(eq(contractorJob.assetId, SEED_SERVICE_ASSET_ID))
		);
		expect(job?.status).toBe('completed');
	});

	test('the unit shows its service history on the asset page', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto(`/staff/inventory/assets/${SEED_SERVICE_ASSET_ID}`);

		await expect(page.getByRole('heading', { name: SEED_SERVICE_ASSET_TAG })).toBeVisible({
			timeout: 15000
		});
		await expect(page.getByRole('heading', { name: 'Service', exact: true })).toBeVisible();
		// The completed job from the test above, on the unit it was about.
		await expect(page.getByRole('link', { name: 'Retube the E2E amp' })).toBeVisible();
	});
});
