import { test, expect } from './fixtures/test';
import {
	SEED_TP_EVENT_ID,
	SEED_TP_EVENT_TITLE,
	SEED_TP_PRICE_CENTS
} from './fixtures/seed-ticket-purchase';

/**
 * Ticket checkout on the sliding scale, as a guest sees it: the amount the page
 * shows on its button, through the fake payment driver, to a valid ticket or a
 * decline.
 *
 * What the page previews before submit (opening amounts, split bar bounds, fee
 * offer, refused amounts) is pinned in `TicketPurchaseFields.svelte.spec.ts`;
 * the split arithmetic in `ticket-split.spec.ts`. These two cases are the only
 * coverage of the round trip through fulfillment — pending ticket, payment,
 * webhook translation, valid ticket — which `PAYMENTS_DRIVER=fake` makes
 * assertable (see `playwright.config.ts`).
 */

const PRICE = SEED_TP_PRICE_CENTS / 100;
const ticketsUrl = `/events/${SEED_TP_EVENT_ID}/tickets`;
const GUEST_EMAIL = 'e2e-guest@example.test';

/** An amount as the page prints it: 91 → "$0.91". Amounts are state, not copy. */
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The purchase form's one submit: "Pay $x" or "Get ticket", by amount. */
const submitButton = (page: import('@playwright/test').Page) =>
	page.locator('form:has(#ticketAmount) button[type="submit"]');

/**
 * `goto` resolves before an awaited remote query commits, so wait on real
 * content rather than an empty `<main>`.
 */
async function openPurchasePage(page: import('@playwright/test').Page) {
	await page.goto(ticketsUrl);
	await expect(page.getByRole('heading', { name: SEED_TP_EVENT_TITLE })).toBeVisible();
}

/**
 * Type an amount into the scale, and be sure it actually landed.
 *
 * The heading this page waits on is server-rendered, so it is visible before the
 * page's JavaScript has loaded and Svelte has attached its handlers. A fill in
 * that window sets a value nothing is listening to — the preview never updates,
 * and the assertion that follows waits out its timeout against a total that will
 * never change.
 *
 * **The retry loop has to out-live its own assertion.** `expect.timeout` is
 * 15000ms globally (playwright.config.ts), which was exactly the budget given to
 * `toPass` — so the first `toHaveValue` inside the loop spent the whole thing and
 * `toPass` never got a second iteration. The retry this function is built around
 * had never once run: the CI trace for the failure shows one `fill("")`, one
 * `fill("0.50")`, and then thirty-odd polls of an input still reading its
 * server-rendered value. A short inner timeout is what makes the loop a loop.
 *
 * **And the retry has to clear the box first.** `fill()` on an input that already
 * holds the target text is a no-op that fires no `input` event — so once a lost
 * fill has written the value, every retry does nothing and the loop can never
 * recover. Clearing guarantees a real change on each attempt.
 */
async function payPerTicket(page: import('@playwright/test').Page, dollars: string) {
	const amount = page.locator('#ticketAmount');
	const cents = page.locator('input:is([name$="unitPriceCents"], [name*="unitPriceCents/"])');
	const target = String(Math.round(Number(dollars) * 100));
	// A target the server already rendered passes the check below on its first
	// poll, hydrated or not, and a click after that can beat hydration (#2551).
	// Moving off it first is a change that only a hydrated page can make.
	if ((await cents.inputValue()) === target) {
		await payPerTicket(page, (Number(dollars) + 1).toFixed(2));
	}
	await expect(async () => {
		await amount.fill('');
		await amount.fill(dollars);
		await expect(cents).toHaveValue(
			target,
			// Deliberately far below the enclosing `toPass` budget: this is one
			// attempt, not the deadline. Hydration lands in well under a second once
			// it lands at all, so an attempt that has not taken by now is one where
			// the fill went nowhere, and the answer is to type again.
			{ timeout: 1000 }
		);
	}).toPass({ timeout: 15000 });
}

/**
 * The in-app checkout page, on the fake driver. It is the same `/checkout/<session>`
 * route a real `ui_mode: 'elements'` session lands on — the page asks the server
 * which gateway is live and renders a card-number form instead of a Payment
 * Element, so the navigation under test is the production one.
 */
async function payOnFakeCheckout(page: import('@playwright/test').Page, cardNumber: string) {
	await expect(page).toHaveURL(/\/checkout\//);
	// The fake driver's card form, rather than a Payment Element.
	const card = page.locator('input:is([name$="cardNumber"], [name*="cardNumber/"])');
	await expect(card).toBeVisible();
	await card.fill(cardNumber);
	await page
		.locator(
			'form:has(input:is([name$="cardNumber"], [name*="cardNumber/"])) button[type="submit"]'
		)
		.click();
}

async function fillGuestDetails(page: import('@playwright/test').Page) {
	await page.locator('input:is([name$="attendeeName"], [name*="attendeeName/"])').fill('E2E Guest');
	await page
		.locator('input:is([name$="attendeeEmail"], [name*="attendeeEmail/"])')
		.fill(GUEST_EMAIL);
}

/**
 * Commit the purchase.
 *
 * The button is labelled with the amount — `TicketPurchaseFields` owns it,
 * because only that component knows what the card is charged — so there is no
 * fixed string to match and matching the amount is the better assertion anyway:
 * the number on the button is the number the server is about to charge.
 *
 * `payPerTicket` first, to set that amount explicitly rather than trusting the
 * default, and because it doubles as the hydration proof: it retries until the
 * hidden field has changed, which cannot happen before Svelte has attached.
 * Submitting a remote form before hydration would post it as a plain GET.
 */
async function submitPurchase(page: import('@playwright/test').Page) {
	await payPerTicket(page, PRICE.toFixed(2));
	await expect(submitButton(page)).toContainText(usd(SEED_TP_PRICE_CENTS));
	await submitButton(page).click();
}

test('a guest buys a ticket and it comes back valid', async ({ page }) => {
	await openPurchasePage(page);
	await fillGuestDetails(page);

	await submitPurchase(page);

	await payOnFakeCheckout(page, '4242424242424242');

	// The success page is keyed on purchase_id, which only the completed session
	// carries — landing here at all proves the redirect survived the round trip.
	await expect(page).toHaveURL(/\/tickets\/success\?purchase_id=/);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	// The `Your Tickets` list renders one row per ticket the query returns, and it
	// only returns `valid` rows — a still-`pending` ticket leaves it empty. The
	// code beside the label is what the door scans, so its presence is the real
	// proof fulfillment ran.
	// `exact`: the buyer's address also appears in the "a receipt will be sent to
	// …" sentence above, and a substring match resolves to both.
	await expect(page.getByText(GUEST_EMAIL, { exact: true })).toBeVisible();
	await expect(page.getByTestId('ticket-code')).not.toBeEmpty();
});

test('a declined card keeps the buyer on checkout with the real decline copy', async ({ page }) => {
	await openPurchasePage(page);
	await fillGuestDetails(page);

	await submitPurchase(page);

	await payOnFakeCheckout(page, '4000000000000002');

	// eslint-disable-next-line custom/no-wording-locators -- the processor's decline copy, shown verbatim on purpose
	await expect(page.getByText('Your card has been declined.')).toBeVisible();
	await expect(page).toHaveURL(/\/checkout\//);
});
