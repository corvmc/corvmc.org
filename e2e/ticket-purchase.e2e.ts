import { test, expect } from '@playwright/test';
import {
	SEED_TP_EVENT_ID,
	SEED_TP_EVENT_TITLE,
	SEED_TP_PRICE_CENTS
} from './fixtures/seed-ticket-purchase';

/**
 * Ticket checkout pricing, as a guest sees it.
 *
 * What the unit tests already prove: what the server charges, what the ticket
 * row records, how the receipt splits the charge. What they cannot prove is that
 * the number the buyer reads before they commit is the number the server will
 * charge — the preview arithmetic lives in a Svelte component and the charge
 * lives in a remote function, and the two agreeing is the whole point of
 * `TicketPurchaseFields`.
 *
 * Nothing here submits. The next step after the button is Stripe Checkout, and
 * a test suite has no business opening one.
 */

const PRICE = SEED_TP_PRICE_CENTS / 100;
const ticketsUrl = `/events/${SEED_TP_EVENT_ID}/tickets`;

/**
 * The page's own totals block. `goto` resolves before an awaited remote query
 * commits, so every assertion waits on real content rather than an empty
 * `<main>` — a negative assertion would otherwise pass against nothing.
 */
async function openPurchasePage(page: import('@playwright/test').Page) {
	await page.goto(ticketsUrl);
	await expect(page.getByRole('heading', { name: SEED_TP_EVENT_TITLE })).toBeVisible();
	return page.getByText('Total', { exact: true }).locator('..');
}

test('a guest sees the ticket price as the total before adding anything', async ({ page }) => {
	const totals = await openPurchasePage(page);

	await expect(totals).toContainText(`$${PRICE.toFixed(2)}`);
});

test('a contribution quick-pick lands in the total', async ({ page }) => {
	const totals = await openPurchasePage(page);

	await page.getByRole('button', { name: '$10.00' }).click();

	await expect(page.getByText('Contribution', { exact: true })).toBeVisible();
	await expect(totals).toContainText(`$${(PRICE + 10).toFixed(2)}`);
});

test('a typed contribution lands in the total', async ({ page }) => {
	const totals = await openPurchasePage(page);

	// FormField wraps its input in a fieldset+legend rather than a `for`-linked
	// label, so the field is reached through its group, not getByLabel.
	await page
		.getByRole('group', { name: /Add a contribution/i })
		.getByRole('textbox')
		.fill('7.50');

	await expect(totals).toContainText(`$${(PRICE + 7.5).toFixed(2)}`);
});

test('the fee-coverage offer is priced on the gift as well as the tickets', async ({ page }) => {
	// Stripe takes its cut of everything it collects, so a preview that fees only
	// the ticket subtotal would quote a total the card statement disagrees with.
	// $20 grosses up to a $0.91 fee; $20 + a $25 gift to $1.66.
	await openPurchasePage(page);

	await expect(page.getByText(/Add \$0\.91 to cover processing fees/i)).toBeVisible();

	await page.getByRole('button', { name: '$25.00' }).click();

	await expect(page.getByText(/Add \$1\.66 to cover processing fees/i)).toBeVisible();
});

test('a guest is never offered the member-discount waiver', async ({ page }) => {
	// The checkbox is meaningless without a discount to decline, and offering it
	// to a signed-out buyer reads as a way to pay less.
	await openPurchasePage(page);

	await expect(page.getByText(/skip my 50% member discount/i)).toBeHidden();
});

test('the door policy is stated on the page, since checkout cannot sell a free ticket', async ({
	page
}) => {
	await openPurchasePage(page);

	await expect(page.getByText(/No one is turned away for lack of funds/i)).toBeVisible();
});
