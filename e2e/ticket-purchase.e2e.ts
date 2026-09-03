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
 * The last two cases do submit. They can, now that `PAYMENTS_DRIVER=fake` puts
 * an in-memory gateway behind checkout (see `playwright.config.ts`): the button
 * leads to a local page rather than `checkout.stripe.com`, so the round trip
 * through fulfillment — pending ticket, payment, webhook translation, valid
 * ticket — is finally assertable. It is the only coverage of that path; the unit
 * tests hand `handleCheckoutCompleted` a session literal and start from there.
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

/**
 * Click a contribution preset, and be sure the click actually landed.
 *
 * The heading this page waits on is server-rendered, so it is visible before
 * the page's JavaScript has loaded and Svelte has attached its handlers. A
 * click in that window hits a button that is not wired to anything yet and is
 * simply lost — the preset never applies, and the assertion that follows waits
 * out its timeout against a total that will never change. It bit the *first*
 * interactive test in this file and no other, because by the second one the
 * browser has the page's modules cached and hydration wins the race.
 *
 * Retrying is only safe because this re-reads the button before each attempt:
 * the handler toggles, so a blind second click would clear the preset it just
 * set. `btn-primary` is how `Button` renders `variant="primary"`, which the
 * component gives the preset whose value is currently applied — the same state
 * the assertions below are about to read, so it cannot pass while the click is
 * still lost.
 */
async function pickContribution(page: import('@playwright/test').Page, label: string) {
	const button = page.getByRole('button', { name: label });
	await expect(async () => {
		const applied = ((await button.getAttribute('class')) ?? '').includes('btn-primary');
		if (!applied) await button.click();
		expect((await button.getAttribute('class')) ?? '').toContain('btn-primary');
	}).toPass({ timeout: 15000 });
}

test('a guest sees the ticket price as the total before adding anything', async ({ page }) => {
	const totals = await openPurchasePage(page);

	await expect(totals).toContainText(`$${PRICE.toFixed(2)}`);
});

test('a contribution quick-pick lands in the total', async ({ page }) => {
	const totals = await openPurchasePage(page);

	await pickContribution(page, '$10.00');

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

	// Scoped to the checkbox by `name` rather than matched on its sentence: the
	// grossed-up amount is the contract, the wording around it is not.
	// `name$=`: a remote form prefixes a boolean field's name (`b:coverFees`).
	const coverFees = page.locator('input[name$="coverFees"]').locator('..');

	await expect(coverFees).toContainText('$0.91');

	await pickContribution(page, '$25.00');

	await expect(coverFees).toContainText('$1.66');
});

test('a guest is never offered the member-discount waiver', async ({ page }) => {
	// The checkbox is meaningless without a discount to decline, and offering it
	// to a signed-out buyer reads as a way to pay less.
	await openPurchasePage(page);

	await expect(page.locator('input[name$="waiveDiscount"]')).toHaveCount(0);
});

test('the door policy is stated on the page, since checkout cannot sell a free ticket', async ({
	page
}) => {
	await openPurchasePage(page);

	// The policy paragraph is the only thing on the page linking to /contact.
	await expect(page.locator('main a[href="/contact"]')).toBeVisible();
});

/**
 * The fake gateway's stand-in for Stripe Checkout. Reached by the same
 * `window.location.href` the real integration uses, so nothing about the app's
 * navigation is special-cased for the test.
 */
async function payOnFakeCheckout(page: import('@playwright/test').Page, cardNumber: string) {
	await expect(page).toHaveURL(/\/checkout\/fake\//);
	await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
	await page.locator('input[name$="cardNumber"]').fill(cardNumber);
	await page.getByRole('button', { name: /^Pay / }).click();
}

async function fillGuestDetails(page: import('@playwright/test').Page) {
	await page.locator('input[name$="attendeeName"]').fill('E2E Guest');
	await page.locator('input[name$="attendeeEmail"]').fill('e2e-guest@example.test');
}

test('a guest buys a ticket and it comes back valid', async ({ page }) => {
	await openPurchasePage(page);
	await fillGuestDetails(page);

	await page.getByRole('button', { name: /Purchase Ticket/i }).click();

	await payOnFakeCheckout(page, '4242424242424242');

	// The success page is keyed on purchase_id, which only the completed session
	// carries — landing here at all proves the redirect survived the round trip.
	await expect(page).toHaveURL(/\/tickets\/success\?purchase_id=/);
	await expect(page.getByRole('heading', { name: 'Tickets Confirmed' })).toBeVisible();
	// A ticket code renders only for a ticket the webhook flipped to `valid`; a
	// `pending` row would leave this list empty.
	await expect(page.getByText('e2e-guest@example.test')).toBeVisible();
});

test('a declined card keeps the buyer on checkout with the real decline copy', async ({ page }) => {
	await openPurchasePage(page);
	await fillGuestDetails(page);

	await page.getByRole('button', { name: /Purchase Ticket/i }).click();

	await payOnFakeCheckout(page, '4000000000000002');

	await expect(page.getByText('Your card has been declined.')).toBeVisible();
	await expect(page).toHaveURL(/\/checkout\/fake\//);
});
