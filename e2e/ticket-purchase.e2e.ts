import { test, expect } from '@playwright/test';
import {
	SEED_TP_EVENT_ID,
	SEED_TP_EVENT_TITLE,
	SEED_TP_FLOOR_EVENT_ID,
	SEED_TP_FLOOR_CENTS,
	SEED_TP_PRICE_CENTS
} from './fixtures/seed-ticket-purchase';

/**
 * Ticket checkout on the sliding scale, as a guest sees it.
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
const FLOOR = SEED_TP_FLOOR_CENTS / 100;
const ticketsUrl = `/events/${SEED_TP_EVENT_ID}/tickets`;
const flooredUrl = `/events/${SEED_TP_FLOOR_EVENT_ID}/tickets`;

/**
 * The page's own totals block. `goto` resolves before an awaited remote query
 * commits, so every assertion waits on real content rather than an empty
 * `<main>` — a negative assertion would otherwise pass against nothing.
 */
async function openPurchasePage(page: import('@playwright/test').Page, url = ticketsUrl) {
	await page.goto(url);
	await expect(page.getByRole('heading', { name: SEED_TP_EVENT_TITLE })).toBeVisible();
	return page.getByText('Total', { exact: true }).locator('..');
}

/**
 * Type an amount into the scale, and be sure it actually landed.
 *
 * The heading this page waits on is server-rendered, so it is visible before the
 * page's JavaScript has loaded and Svelte has attached its handlers. A fill in
 * that window sets a value nothing is listening to — the preview never updates,
 * and the assertion that follows waits out its timeout against a total that will
 * never change. It bit the *first* interactive test in this file and no other,
 * because by the second one the browser has the page's modules cached and
 * hydration wins the race.
 */
async function payPerTicket(page: import('@playwright/test').Page, dollars: string) {
	const amount = page.locator('#ticketAmount');
	await expect(async () => {
		await amount.fill(dollars);
		await expect(page.locator('input[name$="unitPriceCents"]')).toHaveValue(
			String(Math.round(Number(dollars) * 100))
		);
	}).toPass({ timeout: 15000 });
}

test('the scale opens at the suggested price', async ({ page }) => {
	const totals = await openPurchasePage(page);

	await expect(totals).toContainText(`$${PRICE.toFixed(2)}`);
	await expect(page.locator('#ticketAmount')).toHaveValue(PRICE.toFixed(2));
});

test('the split bar opens with the collective at its suggested share', async ({ page }) => {
	// $20, less 88¢ of card processing, leaves $19.12 to divide; 30% of that is
	// $5.74 and the acts take the rest. The point of the assertion is that the
	// share is of what is *divisible* — 30% of the gross would read $6.00.
	await openPurchasePage(page);

	const bar = page.getByRole('slider');
	await expect(bar).toHaveAttribute('aria-valuenow', '574');
	await expect(page.getByText('$13.38')).toBeVisible();
});

test('moving the bar moves what the acts get, and what is posted', async ({ page }) => {
	// Keyboard rather than a drag: the divider is a real slider, and the drag is
	// the affordance rather than the mechanism.
	await openPurchasePage(page);

	const bar = page.getByRole('slider');
	await bar.focus();
	await bar.press('ArrowLeft');
	await bar.press('ArrowLeft');

	await expect(bar).toHaveAttribute('aria-valuenow', '524');
	await expect(page.locator('input[name$="collectiveCents"]')).toHaveValue('524');
});

test('the fee-coverage offer is priced on everything the card is charged', async ({ page }) => {
	// Stripe takes its cut of the whole charge, so a preview that fees only the
	// suggested price would quote a total the card statement disagrees with.
	// $20 grosses up to a $0.91 fee; $45 to $1.66.
	await openPurchasePage(page);

	// Scoped to the checkbox by `name` rather than matched on its sentence: the
	// grossed-up amount is the contract, the wording around it is not.
	// `name$=`: a remote form prefixes a boolean field's name (`b:coverFees`).
	const coverFees = page.locator('input[name$="coverFees"]').locator('..');
	await expect(coverFees).toContainText('$0.91');

	await payPerTicket(page, '45');

	await expect(coverFees).toContainText('$1.66');
});

test('paying above the suggestion shows up as a contribution', async ({ page }) => {
	const totals = await openPurchasePage(page);

	await payPerTicket(page, '30');

	await expect(page.getByText('Contribution', { exact: true })).toBeVisible();
	await expect(totals).toContainText('$30.00');
});

test('a scale that runs to free offers a free ticket, not a $0 charge', async ({ page }) => {
	await openPurchasePage(page);

	await payPerTicket(page, '0');

	// The split bar goes away with the money, and the button stops asking for a
	// card.
	await expect(page.getByRole('slider')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Get ticket/i })).toBeEnabled();
});

test('the dead zone below the charge minimum is refused on the page', async ({ page }) => {
	await openPurchasePage(page);

	await payPerTicket(page, '0.50');

	await expect(page.getByText(/at least \$2\.00/)).toBeVisible();
	await expect(page.getByRole('button', { name: /^Pay/ })).toBeDisabled();
});

test('a guest is never offered a member discount, because there is not one', async ({ page }) => {
	await openPurchasePage(page);

	await expect(page.locator('input[name$="waiveDiscount"]')).toHaveCount(0);
	await expect(page.getByText(/50% off/i)).toHaveCount(0);
});

test('a show with a floor says so, and refuses less', async ({ page }) => {
	await page.goto(flooredUrl);
	await expect(page.getByRole('heading', { name: 'E2E Show With A Floor' })).toBeVisible();

	await expect(page.getByText(`$${FLOOR.toFixed(2)} minimum`)).toBeVisible();

	await payPerTicket(page, '2');

	await expect(page.getByText(/least you can pay/)).toBeVisible();
	await expect(page.getByRole('button', { name: /^Pay/ })).toBeDisabled();
});
