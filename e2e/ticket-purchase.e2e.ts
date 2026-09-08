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
	await expect(async () => {
		await amount.fill('');
		await amount.fill(dollars);
		await expect(page.locator('input[name$="unitPriceCents"]')).toHaveValue(
			String(Math.round(Number(dollars) * 100)),
			// Deliberately far below the enclosing `toPass` budget: this is one
			// attempt, not the deadline. Hydration lands in well under a second once
			// it lands at all, so an attempt that has not taken by now is one where
			// the fill went nowhere, and the answer is to type again.
			{ timeout: 1000 }
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

	// Read off the slider rather than off the page: SplitBar writes each amount
	// twice — once in the bar, once in the labelled list beneath it — so a bare
	// getByText is a strict mode violation rather than a missing element.
	// `aria-valuetext` carries both figures in one place, and is the thing a
	// screen reader is told, which makes it the better contract anyway.
	const bar = page.getByRole('slider');
	await expect(bar).toHaveAttribute('aria-valuenow', '574');
	await expect(bar).toHaveAttribute('aria-valuetext', /\$5\.74.*\$13\.38/);
	await expect(page.locator('input[name$="collectiveCents"]')).toHaveValue('574');
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

	// `.first()`: the message sits inside nested elements, and getByText matches
	// every ancestor whose text contains it.
	await expect(page.getByText(/at least \$2\.00/).first()).toBeVisible();
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

	await expect(page.getByText(`$${FLOOR.toFixed(2)} minimum`).first()).toBeVisible();

	await payPerTicket(page, '2');

	await expect(page.getByText(/least you can pay/).first()).toBeVisible();
	await expect(page.getByRole('button', { name: /^Pay/ })).toBeDisabled();
});

/**
 * The guard on `payPerTicket`'s retry loop, which for its whole life had never
 * run a second iteration.
 *
 * Holding the entry chunk back reproduces, deterministically, what CI hits by
 * luck on a slow runner: the server-rendered heading is visible, the test types,
 * and nothing is listening yet. With the inner assertion on the global 15s
 * `expect.timeout` this fails exactly as CI did — one attempt, then the whole
 * budget spent watching a value that cannot change. It is the only test here
 * that would notice if that timeout were tidied away again.
 */
test('a fill that lands before hydration is retried, not waited out', async ({ page }) => {
	let held = 0;
	await page.route('**/_app/immutable/entry/*.js', async (route) => {
		held++;
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});

	await openPurchasePage(page);
	await payPerTicket(page, '30');

	// Without this the test passes for the wrong reason the day the build stops
	// emitting that path: the route matches nothing, hydration is never delayed,
	// and a guard against a hydration race quietly stops involving one.
	expect(held, 'the entry chunk was never intercepted, so nothing was delayed').toBeGreaterThan(0);
	await expect(page.getByText('Contribution', { exact: true })).toBeVisible();
});
