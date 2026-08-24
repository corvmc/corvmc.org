import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	COMPED_CASE_INDEX,
	PAYMENT_CASES,
	SEED_PAYMENTS_NAME,
	expectedCashCents
} from './fixtures/seed-reservation-payments';

/**
 * The staff reservation list's Payment column.
 *
 * It used to render one gross figure, duration × hourly rate, regardless of how
 * the booking was actually settled — so a reservation paid entirely in free-hour
 * credits still displayed full list price, reading as though the member owed it.
 * The column now splits into the cash half and the credit half and drops
 * whichever is zero.
 *
 * `formatPaymentBreakdown` is unit-tested directly; what this pins is the wiring
 * — that `creditsUsed` actually reaches the cell from `getStaffReservations`.
 * That is the half a unit test cannot see, and the half most likely to rot: the
 * value is one of ~20 columns in a hand-written select list.
 */
async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test.describe('staff reservations payment column', () => {
	test('breaks payment into dollars and credits', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/reservations');
		await expect(page).toHaveURL(/\/staff\/reservations/);

		// Narrow to the fixture's member so the assertions below don't have to
		// survive whatever else the dev seed put on the calendar.
		await page.getByPlaceholder('Search member, band, or event...').fill(SEED_PAYMENTS_NAME);

		const rows = page.getByRole('row').filter({ hasText: SEED_PAYMENTS_NAME });
		await expect(rows).toHaveCount(PAYMENT_CASES.length);

		for (const [i, c] of PAYMENT_CASES.entries()) {
			await expect(rows.nth(i)).toContainText(c.expected);
		}
	});

	test('omits the half that evaluates to zero', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/reservations');
		await page.getByPlaceholder('Search member, band, or event...').fill(SEED_PAYMENTS_NAME);

		const rows = page.getByRole('row').filter({ hasText: SEED_PAYMENTS_NAME });
		await expect(rows).toHaveCount(PAYMENT_CASES.length);

		// A booking with no credits shows no credit term...
		await expect(rows.nth(0)).not.toContainText('cr');
		// ...and one fully covered by credits shows no dollar figure. This is the
		// regression that motivated the change: it used to read "$30.00".
		await expect(rows.nth(3)).not.toContainText('$');
	});

	test('strikes the amount on a comped reservation', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/reservations');
		await page.getByPlaceholder('Search member, band, or event...').fill(SEED_PAYMENTS_NAME);

		const rows = page.getByRole('row').filter({ hasText: SEED_PAYMENTS_NAME });
		await expect(rows).toHaveCount(PAYMENT_CASES.length);

		// Comping waives the charge without hiding what the room time was worth.
		const comped = rows.nth(COMPED_CASE_INDEX);
		await expect(comped.locator('.line-through')).toHaveText('$30.00');

		// Every other row keeps its amount unstruck.
		await expect(rows.nth(0).locator('.line-through')).toHaveCount(0);
		await expect(rows.nth(3).locator('.line-through')).toHaveCount(0);
	});
});

test.describe('payment breakdown fixture', () => {
	// Guards the table above from drifting out of sync with the rate it assumes.
	test('cases match the arithmetic they claim', () => {
		for (const c of PAYMENT_CASES) {
			const cash = expectedCashCents(c.hours, c.creditsUsed);
			if (cash > 0) expect(c.expected).toContain(`$${(cash / 100).toFixed(2)}`);
			else expect(c.expected).not.toContain('$');
		}
	});
});
