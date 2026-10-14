import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { readLocalDb } from './fixtures/platform-db';
import { inventoryAsset, stockMovement } from '../src/lib/server/db/schema/inventory';
import { contractorJob } from '../src/lib/server/db/schema/contractor';
import { workOrder } from '../src/lib/server/db/schema/volunteer';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_CONTRACTOR_NAME, SEED_SERVICE_ASSETS } from './fixtures/seed-contractors';

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
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/** The unit's status and every movement against it, read straight off the file. */
async function assetState(assetId: string) {
	const [asset] = await readLocalDb((db) =>
		db
			.select({ status: inventoryAsset.status })
			.from(inventoryAsset)
			.where(eq(inventoryAsset.id, assetId))
	);
	const movements = await readLocalDb((db) =>
		db
			.select({ reason: stockMovement.reason, quantity: stockMovement.quantity })
			.from(stockMovement)
			.where(eq(stockMovement.assetId, assetId))
	);
	return { status: asset?.status ?? null, movements };
}

/** The engagement on the unit and its work order's resolution. */
async function jobState(assetId: string) {
	const [job] = await readLocalDb((db) =>
		db
			.select({ status: contractorJob.status, resolvedAt: workOrder.resolvedAt })
			.from(contractorJob)
			.innerJoin(workOrder, eq(workOrder.id, contractorJob.workOrderId))
			.where(eq(workOrder.assetId, assetId))
	);
	return job ?? null;
}

test.describe('contractor jobs', () => {
	/**
	 * One workflow, one test, on purpose: the states are sequential — a job
	 * cannot be completed before it is scheduled — so splitting them would mean
	 * each test rebuilding the state the last one left. Each attempt takes its
	 * own unit and title, so a retry never meets the rows an earlier one left.
	 */
	test('a repair takes the unit out of service and brings it back', async ({ page }, { retry }) => {
		const asset = SEED_SERVICE_ASSETS[retry];
		const title = `Retube ${asset.tag}`;
		const state = () => assetState(asset.id);
		await loginAsStaff(page);

		// The unit starts in service, with nothing against it.
		const before = await state();
		expect(before.status).toBe('in_service');

		// Open a job against the unit.
		await page.goto('/staff/contractors/jobs');
		await expect(page.getByRole('heading', { name: 'Contractor jobs' })).toBeVisible();

		await page.getByRole('button', { name: 'New job' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('select').first().selectOption({ label: SEED_CONTRACTOR_NAME });
		await dialog.locator('input[name$="title"]').fill(title);
		await dialog.locator('input[name$="assetId"]').fill(asset.id);
		await modalSubmit(page, /^New job$/).click();

		const jobRow = page.getByRole('row').filter({ hasText: title });
		await expect(jobRow).toBeVisible({ timeout: 15000 });

		// Opening a job is not sending the unit anywhere — the ledger must be
		// untouched until it is actually scheduled.
		expect((await state()).status).toBe('in_service');

		// Book it: this is what takes the unit out of service.
		await jobRow.getByRole('link', { name: title }).click();
		await page.getByRole('button', { name: 'Book', exact: true }).click();
		await modalSubmit(page, /^Book$/).click();

		// Poll the movement rather than read it bare. `setAssetStatus` commits the
		// status row and the ledger row in one `db.batch`, so the window this
		// polling was written for is closed: there is no longer a moment where the
		// status reads `maintenance` with no `repair_out` behind it. That gap —
		// two separate awaits, the status landing first — is what dequeued PR #415
		// while `main` was green, and the shape is kept because polling the
		// movement covers the status with it now that the two commit together.
		await expect
			.poll(async () => (await state()).movements.filter((m) => m.reason === 'repair_out').length, {
				timeout: 15000
			})
			.toBe(1);
		expect((await state()).status).toBe('maintenance');

		// Complete it: back in service, and the ledger nets out.
		await page.getByRole('button', { name: 'Complete', exact: true }).click();
		await modalSubmit(page, /^Complete$/).click();

		// Poll the work order's resolution, not `repair_in`: completing writes the
		// engagement, then the unit's batch, then the work order, as separate
		// statements. A read the moment `repair_in` lands can beat the last one.
		await expect
			.poll(async () => (await jobState(asset.id))?.resolvedAt ?? null, {
				timeout: 15000
			})
			.not.toBeNull();
		expect((await jobState(asset.id))?.status).toBe('completed');

		const after = await state();
		expect(after.status).toBe('in_service');
		expect(after.movements.filter((m) => m.reason === 'repair_out')).toHaveLength(1);
		expect(after.movements.filter((m) => m.reason === 'repair_in')).toHaveLength(1);
		// The two cancel: a unit that went out and came back is neither added to
		// nor taken from stock on balance.
		expect(after.movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(0);

		// Finished with no cost entered: it leaves Open and waits on its invoice.
		await page.goto('/staff/contractors/jobs?view=awaiting-invoice');
		await expect(page.getByRole('row').filter({ hasText: title })).toContainText(
			'Awaiting invoice',
			{ timeout: 15000 }
		);

		// And the unit keeps the job in its service history.
		await page.goto(`/staff/inventory/assets/${asset.id}`);
		await expect(page.getByRole('heading', { name: asset.tag })).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole('heading', { name: 'Service', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: title })).toBeVisible();
	});
});
