import { eq } from 'drizzle-orm';
import { inventoryLoan, stockMovement } from '../src/lib/server/db/schema/inventory';
import { readLocalDb } from './fixtures/platform-db';
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
	SEED_DISPOSED_ASSET_ID,
	SEED_ARTICLE_TITLE,
	SEED_DISPOSED_ASSET_TAG,
	SEED_UNACKED_ASSET_ID,
	SEED_UNACKED_ASSET_TAG,
	SEED_SIGN_ASSET_ID,
	SEED_SIGN_ASSET_TAG,
	SEED_SIGN_DONATION_ID,
	SEED_SIGN_DONOR,
	SEED_OWED_ACQUISITION_ID,
	SEED_OWED_SUPPLIER,
	SEED_LOW_NAME,
	SEED_LOW_ON_HAND,
	SEED_LOW_REORDER_QUANTITY,
	SEED_UNTAGGED_ASSET_ID,
	SEED_MAINTENANCE_ASSET_ID,
	SEED_LOAN_MEMBER_EMAIL,
	SEED_LOAN_MEMBER_PASSWORD,
	SEED_SCHEDULE_LOAN_ID,
	SEED_CHECKOUT_LOAN_ID,
	SEED_CHECKOUT_ASSET_ID,
	SEED_CHECKOUT_ASSET_TAG,
	SEED_RETURN_LOAN_ID,
	SEED_RETURN_ASSET_ID,
	SEED_CANCEL_LOAN_ID,
	SEED_RETURN_DAILY_RATE
} from './fixtures/seed-inventory';

/**
 * End-to-end coverage for the inventory rebuild (#286).
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

/**
 * Sign in as the borrower rather than as staff.
 *
 * Every other test in this file runs as staff, including the two that assert on
 * member-panel pages — so the member half of the loan flow, and `entityHref`'s
 * member arm, were only ever exercised by a unit spec.
 */
async function loginAsMember(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_LOAN_MEMBER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_LOAN_MEMBER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/** Every movement recorded against one unit, summed. */
async function ledgerSumFor(assetId: string): Promise<number> {
	const rows = await readLocalDb((db) =>
		db
			.select({ quantity: stockMovement.quantity })
			.from(stockMovement)
			.where(eq(stockMovement.assetId, assetId))
	);
	return rows.reduce((total, r) => total + r.quantity, 0);
}

/** The submit inside an open Action modal, as distinct from the trigger. */
function modalSubmit(page: Page, name: RegExp) {
	return page.getByRole('dialog').getByRole('button', { name });
}

/**
 * Load a page and wait for it to have actually rendered.
 *
 * These pages take their data from an awaited remote query, so the whole
 * template — heading included — is gated behind it. `page.goto` resolves on
 * `load`, which is comfortably before that commits, and a read taken then sees
 * an empty `<main>`.
 *
 * This matters most for a *negative* assertion: "the row is not there" is
 * trivially true of a page that has rendered nothing, so a poll without this
 * gate reports success for a row that simply had not arrived yet.
 */
async function visit(page: Page, path: string, heading: string) {
	await page.goto(path);
	await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
}

/** Whether the compliance queue currently lists a unit, re-read from scratch. */
async function complianceLists(page: Page, tag: string): Promise<boolean> {
	await visit(page, '/staff/inventory/compliance', 'Compliance');
	return page.getByText(tag).isVisible();
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

	/**
	 * Replenishment. A reorder point that only draws a badge on a detail page is
	 * not doing anything — these pin that it reaches somewhere a person looks.
	 */
	/**
	 * The Equipment row is derived from the catalogue, not from a flag, so it has
	 * to be checked against a signed-in member rather than asserted in a unit
	 * test alone — the unit spec pins the branch, this pins the wiring from
	 * `getMemberLayout` through to the rendered sidebar.
	 */
	test('the member nav offers Equipment once there is something to lend', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/member');

		// `aside ul.menu`, the same handle panel-nav.e2e.ts uses — the sidebar is
		// a list inside an <aside>, not a <nav>.
		const nav = page.locator('aside ul.menu').first();
		await expect(nav.getByRole('link', { name: 'Equipment', exact: true })).toBeVisible();

		// The child only renders once the section is open — `NavCollapsible` keys
		// that off the path, the same way "Add a Show" hides under Events. So it
		// is checked from inside the section rather than from the dashboard.
		await page.goto('/member/equipment');
		await expect(nav.getByRole('link', { name: 'My Loans' })).toBeVisible();
	});

	test.describe('running low', () => {
		test('the dashboard surfaces what needs restocking', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto('/staff');

			await expect(page.getByText('Running low')).toBeVisible();
			await expect(page.getByRole('cell', { name: SEED_LOW_NAME })).toBeVisible();
			// The well-stocked consumable must NOT appear — a low-stock list that
			// shows everything is just the catalog again.
			await expect(page.getByRole('cell', { name: SEED_CONSUMABLE_NAME })).toBeHidden();
		});

		test('the restock list says how many to buy', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto('/staff/inventory/restock');

			await expect(page.getByRole('heading', { name: 'Restock' })).toBeVisible();
			const row = page.getByRole('row').filter({ hasText: SEED_LOW_NAME });
			await expect(row).toBeVisible();
			await expect(row).toContainText(String(SEED_LOW_ON_HAND));
			// The reorder quantity wins over "enough to reach the point".
			await expect(row).toContainText(String(SEED_LOW_REORDER_QUANTITY));
		});

		test('an item above its point stays off the restock list', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto('/staff/inventory/restock');
			await expect(page.getByText(SEED_CONSUMABLE_NAME)).toBeHidden();
		});
	});

	/**
	 * Spend. The question Phase 1 existed to make answerable — under the old
	 * schema, using stock up overwrote a number and left nothing to total.
	 */
	test.describe('spend', () => {
		test('totals purchases by category', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto('/staff/inventory/spend');

			await expect(page.getByRole('heading', { name: 'Spend' })).toBeVisible();
			await expect(page.getByText('Total spend')).toBeVisible();
			// The fixture's one purchase covers the E2E category, so it has to show.
			await expect(page.getByRole('cell', { name: 'E2E Test Gear' })).toBeVisible();
		});

		test('a window with no purchases reports nothing rather than erroring', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto('/staff/inventory/spend?from=1990-01-01&to=1990-12-31');
			await expect(page.getByText('Nothing purchased in this window')).toBeVisible();
		});
	});

	/**
	 * Form 8282. The whole point is that the disposal and the paperwork are
	 * separated by months and usually by different people, so these check the
	 * flag actually reaches somewhere it will be seen.
	 */
	test.describe('form 8282', () => {
		test('a donated unit disposed of inside three years raises a warning', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto(`/staff/inventory/assets/${SEED_DISPOSED_ASSET_ID}`);

			await expect(page.getByText('Form 8282 may be due.')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Record 8282' })).toBeVisible();
		});

		test('it is listed where somebody will look for it later', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto('/staff/inventory/compliance');

			const row = page.getByRole('row').filter({ hasText: SEED_DISPOSED_ASSET_TAG });
			await expect(row).toBeVisible();
		});

		/**
		 * The narrowing, which is the whole point of the rule: the signed 8283 is
		 * what makes property reportable, so a gift without one owes nothing no
		 * matter when it was disposed of. Flagging it would be a false positive,
		 * and a warning that is always wrong is one people stop reading.
		 */
		test('a donated unit with no signed 8283 raises nothing', async ({ page }) => {
			await loginAsStaff(page);

			await page.goto(`/staff/inventory/assets/${SEED_UNACKED_ASSET_ID}`);
			await expect(page.getByText('Form 8282 may be due.')).toBeHidden();

			await page.goto('/staff/inventory/compliance');
			await expect(page.getByText(SEED_UNACKED_ASSET_TAG)).toBeHidden();
		});

		test('recording an outcome clears it from the list', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto('/staff/inventory/compliance');

			const row = page.getByRole('row').filter({ hasText: SEED_DISPOSED_ASSET_TAG });
			await row.getByRole('button', { name: 'Record 8282' }).click();
			await page
				.getByRole('dialog')
				.locator('textarea')
				.first()
				.fill('Filed 2026-09-02, copy posted to the donor');
			await page.getByRole('dialog').getByRole('button', { name: 'Record 8282' }).click();
			await expect(page.getByText('Recorded')).toBeVisible({ timeout: 10000 });

			// The obligation is discharged, so it stops asking — the note stays on
			// the unit as the record that it was handled.
			//
			// Polled with the navigation *inside* the poll: `toBeHidden` retries
			// against the DOM it already loaded, so a page fetched a moment early
			// keeps showing the row and the assertion just fails slowly.
			await expect
				.poll(async () => complianceLists(page, SEED_DISPOSED_ASSET_TAG), { timeout: 15000 })
				.toBe(false);

			await page.goto(`/staff/inventory/assets/${SEED_DISPOSED_ASSET_ID}`);
			await expect(page.getByText('Form 8282 may be due.')).toBeHidden();
			await expect(page.getByText('copy posted to the donor')).toBeVisible();
		});
	});

	/**
	 * The loan lifecycle, end to end.
	 *
	 * Nothing seeded a loan before this, so the five-state machine and the charge
	 * it settles had no e2e coverage at all — only unit tests against a mocked
	 * `db`, which cannot see whether the *form* sends what the service needs.
	 *
	 * The invariant worth pinning is the ledger: a loan writes `loan_out` when the
	 * unit leaves and `loan_return` when it comes back, so those two plus the
	 * original `receive` have to sum to exactly one unit on hand.
	 */
	test.describe('loans', () => {
		test('staff schedule a requested loan', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto(`/staff/inventory/loans/${SEED_SCHEDULE_LOAN_ID}`);

			await expect(page.getByText('Schedule Pickup')).toBeVisible();
			await page.locator('input[name="scheduledPickupDate"]').fill('2026-09-10');
			await page.getByRole('button', { name: 'Schedule' }).click();
			await expect(page.getByText('Pickup scheduled')).toBeVisible({ timeout: 10000 });

			// The state moved on, so the next step's control is the one on offer.
			await expect(page.getByText('Mark as Checked Out')).toBeVisible();
		});

		/**
		 * A serialized loan has to name the unit that left the building, or "which
		 * amp came back broken" has no answer — `checkoutLoan` throws
		 * `AssetRequiredError` without one.
		 *
		 * This test is the reason the picker exists. The checkout form used to
		 * submit only a due date, so every serialized checkout failed on that
		 * throw; with no loan e2e, nothing noticed.
		 */
		test('checking out a serialized loan names the unit that left', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto(`/staff/inventory/loans/${SEED_CHECKOUT_LOAN_ID}`);

			await expect(page.getByText('Mark as Checked Out')).toBeVisible();
			await page.locator('input[name="dueDate"]').fill('2026-09-20');

			// The picker offers units by the tag printed on them, which is what a
			// staffer is reading off the sticker in their hand.
			const unitPicker = page.locator('select[name="assetId"]');
			await expect(unitPicker.locator('option', { hasText: SEED_CHECKOUT_ASSET_TAG })).toHaveCount(
				1
			);
			await unitPicker.selectOption(SEED_CHECKOUT_ASSET_ID);
			await page.getByRole('button', { name: 'Check Out' }).click();
			await expect(page.getByText('Checked out')).toBeVisible({ timeout: 10000 });

			// Bound to the loan, and out of the building on the ledger.
			await expect
				.poll(async () => ledgerSumFor(SEED_CHECKOUT_ASSET_ID), { timeout: 15000 })
				.toBe(0);

			await page.goto(`/staff/inventory/assets/${SEED_CHECKOUT_ASSET_ID}`);
			// The status glyph carries its name on `aria-label`, not as body text —
			// daisyUI's tooltip draws through ::before and is invisible to a11y.
			await expect(page.getByRole('img', { name: 'On loan' }).first()).toBeVisible();
		});

		test('returning it computes the charge and brings the ledger back', async ({ page }) => {
			await loginAsStaff(page);

			// Out of the building: the `receive` and the `loan_out` cancel.
			expect(await ledgerSumFor(SEED_RETURN_ASSET_ID)).toBe(0);

			await page.goto(`/staff/inventory/loans/${SEED_RETURN_LOAN_ID}`);
			await expect(page.getByText('Mark as Returned')).toBeVisible();
			// The rate it was checked out at, shown before committing. Not the day
			// count: the fixture stamps `checkedOutAt` exactly N days back, so by the
			// time this runs it is milliseconds into day N+1 and `Math.ceil` says so.
			await expect(
				page.getByText(`× $${SEED_RETURN_DAILY_RATE / 100}.00/day`, { exact: false }).first()
			).toBeVisible();

			await page.getByRole('button', { name: 'Mark Returned' }).click();
			await modalSubmit(page, /Mark Returned/).click();

			// Back on the shelf, and the ledger nets to the one unit on hand.
			await expect.poll(async () => ledgerSumFor(SEED_RETURN_ASSET_ID), { timeout: 15000 }).toBe(1);

			await page.goto(`/staff/inventory/loans/${SEED_RETURN_LOAN_ID}`);
			await expect(page.getByText('No actions available')).toBeVisible();
		});

		test('a member requests a loan from the catalog', async ({ page }) => {
			await loginAsMember(page);
			await page.goto('/member/equipment');

			await page.getByRole('button', { name: 'Request' }).first().click();
			const dialog = page.getByRole('dialog');
			await dialog.locator('input[name="requestedPickupDate"]').fill('2026-09-15');
			await dialog.locator('input[name="estimatedReturnDate"]').fill('2026-09-18');
			await dialog.getByRole('button', { name: /Request/ }).click();

			await page.goto('/member/equipment/loans');
			await expect(page.getByText(SEED_ITEM_NAME).first()).toBeVisible();
		});

		/** A member may withdraw their own request, but only before it is out. */
		test('a member cancels their own request', async ({ page }) => {
			await loginAsMember(page);
			await page.goto('/member/equipment/loans');

			const card = page.locator('.card').filter({ hasText: 'Changed my mind' }).first();
			await card.getByRole('button', { name: /Cancel/ }).click();
			await modalSubmit(page, /Cancel/).click();

			await expect
				.poll(
					async () => {
						const rows = await readLocalDb((db) =>
							db
								.select({ status: inventoryLoan.status })
								.from(inventoryLoan)
								.where(eq(inventoryLoan.id, SEED_CANCEL_LOAN_ID))
						);
						return rows[0]?.status;
					},
					{ timeout: 15000 }
				)
				.toBe('cancelled');
		});

		/**
		 * The member arm of the scan resolver, which nothing covered: the two
		 * member-panel assertions elsewhere navigate directly while signed in as
		 * staff, so `entityHref`'s member branch was only ever unit-tested.
		 */
		test('a scanned tag sends a member to the member page, not the staff one', async ({ page }) => {
			await loginAsMember(page);
			await page.goto(`/a/${SEED_ASSET_TAG}`);

			await expect(page).toHaveURL(`/member/equipment/assets/${SEED_ASSET_ID}`, {
				timeout: 10000
			});
		});
	});

	/**
	 * Acquisitions: what arrived, from whom, and who is owed for it.
	 *
	 * Receiving has written these rows since Phase 1 and nothing could read them
	 * back, which is why the disclosure columns sat empty in production. The
	 * signing test below is the loop that could not previously run at all.
	 */
	test.describe('acquisitions', () => {
		test('lists what the collective has taken in', async ({ page }) => {
			await loginAsStaff(page);
			await visit(page, '/staff/inventory/acquisitions', 'Acquisitions');

			await expect(page.getByRole('row').filter({ hasText: SEED_SIGN_DONOR })).toBeVisible();
			await expect(page.getByRole('row').filter({ hasText: SEED_OWED_SUPPLIER })).toBeVisible();
		});

		/**
		 * **The transition the module shipped without.** `form8282Status` treats a
		 * gift with no signed 8283 as owing nothing, and nothing in the app could
		 * write `acknowledgedAt` — so this unit was disposed of inside the window
		 * and the compliance page stayed silent about it forever. Signing the 8283
		 * is the single act that makes it reportable.
		 */
		test('signing a Form 8283 turns a silent disposal into an obligation', async ({ page }) => {
			await loginAsStaff(page);

			// Before: disposed of, donated, inside the window — and not listed.
			expect(await complianceLists(page, SEED_SIGN_ASSET_TAG)).toBe(false);

			await page.goto(`/staff/inventory/acquisitions/${SEED_SIGN_DONATION_ID}`);
			await page.getByRole('button', { name: 'Record 8283' }).click();
			await page.getByRole('dialog').locator('input[name$="signedOn"]').fill('2026-03-04');
			await page
				.getByRole('dialog')
				.locator('input[name$="appraisalRef"]')
				.fill('Appraisal 2026-03');
			await modalSubmit(page, /^Record 8283$/).click();
			await expect(page.getByText('Acknowledgment recorded')).toBeVisible({ timeout: 10000 });

			// After: the same row, now an obligation with a deadline attached.
			await expect
				.poll(async () => complianceLists(page, SEED_SIGN_ASSET_TAG), { timeout: 15000 })
				.toBe(true);

			await page.goto(`/staff/inventory/assets/${SEED_SIGN_ASSET_ID}`);
			await expect(page.getByText('Form 8282 may be due.')).toBeVisible();
		});

		/**
		 * The app moves no money; this records that a person did. Asserted through
		 * the filter rather than a badge, because leaving the awaiting list is the
		 * behaviour somebody depends on.
		 */
		test('marking a fronted purchase reimbursed clears it from the owed list', async ({ page }) => {
			await loginAsStaff(page);

			await visit(page, '/staff/inventory/acquisitions?owed=1', 'Acquisitions');
			await expect(page.getByRole('row').filter({ hasText: SEED_OWED_SUPPLIER })).toBeVisible();

			await page.goto(`/staff/inventory/acquisitions/${SEED_OWED_ACQUISITION_ID}`);
			await page.getByRole('button', { name: 'Mark reimbursed' }).click();
			await modalSubmit(page, /^Mark reimbursed$/).click();
			await expect(page.getByText('Marked reimbursed')).toBeVisible({ timeout: 10000 });

			await expect
				.poll(
					async () => {
						await visit(page, '/staff/inventory/acquisitions?owed=1', 'Acquisitions');
						return page.getByRole('row').filter({ hasText: SEED_OWED_SUPPLIER }).isVisible();
					},
					{ timeout: 15000 }
				)
				.toBe(false);
		});
	});

	/**
	 * Attached resources. Documentation hangs off the catalog entry, because the
	 * manual for a K12.2 is the manual for all four; a damage report is about one
	 * unit, so it hangs off the asset and writes to the ledger.
	 */
	test.describe('resources and damage', () => {
		test('a member sees the how-to linked to the gear', async ({ page }) => {
			await loginAsStaff(page);
			await page.goto(`/member/equipment/assets/${SEED_ASSET_ID}`);

			await expect(page.getByText('How to use it')).toBeVisible();
			await expect(page.getByRole('link', { name: SEED_ARTICLE_TITLE })).toBeVisible();
		});

		test('reporting damage takes the unit out of service and writes the ledger', async ({
			page
		}) => {
			await loginAsStaff(page);
			await page.goto(`/member/equipment/assets/${SEED_ASSET_ID}`);

			await page.getByRole('button', { name: 'Report a problem' }).click();
			await page.getByRole('dialog').locator('textarea').first().fill('Crackling on channel two');
			await page.getByRole('dialog').getByRole('button', { name: 'Report a problem' }).click();

			// Asserted against the database first: the movement *is* the report, so
			// if it were missing the unit would be out of service with no record of
			// why. `expect.poll` because the preview server is still writing.
			await expect
				.poll(
					async () => {
						const rows = await readLocalDb((db) =>
							db
								.select({ reason: stockMovement.reason, notes: stockMovement.notes })
								.from(stockMovement)
								.where(eq(stockMovement.assetId, SEED_ASSET_ID))
						);
						return rows.filter((r) => r.reason === 'repair_out').length;
					},
					{ timeout: 15000 }
				)
				.toBe(1);

			await page.goto(`/staff/inventory/assets/${SEED_ASSET_ID}`);
			await expect(page.getByText('Out for repair')).toBeVisible();
			await expect(page.getByText('Crackling on channel two')).toBeVisible();
		});

		test('a unit already in the shop is not offered the form again', async ({ page }) => {
			await loginAsStaff(page);
			// Seeded in maintenance rather than left that way by the test above,
			// which made the two order-dependent.
			await page.goto(`/member/equipment/assets/${SEED_MAINTENANCE_ASSET_ID}`);

			// Assert the page is actually there before asserting something is not.
			// `toBeHidden()` passes for an element that does not exist, so on its
			// own it also passes when the page failed to render — which is how this
			// test sat green while the flow it guards was completely broken.
			await expect(page.getByText('Maintenance').first()).toBeVisible();
			await expect(page.getByRole('button', { name: 'Report a problem' })).toBeHidden();
		});
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
