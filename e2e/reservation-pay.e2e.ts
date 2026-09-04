import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { readLocalDb } from './fixtures/platform-db';
import { reservation } from '../src/lib/server/db/schema/reservation';
import {
	SEED_MEMBER_EMAIL,
	SEED_MEMBER_PASSWORD,
	SEED_RESERVATION_ID
} from './fixtures/seed-pay-reservation';

/**
 * Paying for a reservation, all the way through.
 *
 * This began as a narrow regression test. The `coverFees` control is a
 * FormField checkbox bound to a `z.boolean()` schema field, submitted with
 * SvelteKit's `b:` prefix so it arrives as a real boolean; a prior bug typed the
 * schema as `z.enum(['','on'])`, which threw `Invalid option: expected one of
 * ""|"on"` the moment a member checked "cover fees". The test could only assert
 * that the submission got *past* Zod, because the dummy Stripe key meant
 * everything after validation failed — so it treated "a non-JSON 303 toward
 * Stripe" as a pass and inspected the response envelope by hand.
 *
 * With `PAYMENTS_DRIVER=fake` the payment completes locally, so the flow can be
 * asserted by its outcome instead of its envelope. Reaching a confirmed, paid
 * reservation subsumes the original assertion — Zod cannot have rejected a
 * submission that went on to settle — and additionally covers the credit
 * commitment, the fee line, the checkout session, and the webhook translation
 * that flips the row.
 *
 * The read-back goes through `readLocalDb` (read-only) rather than the rendered
 * page: `status` and `paidAt` are the contract, the wording on the list is not.
 * It is polled, because that reader opens the same SQLite file the preview
 * server is still writing through workerd.
 *
 * Card declines are covered in `ticket-purchase.e2e.ts`, not here: this spec
 * owns `SEED_RESERVATION_ID` and spends it, so a second case in this file would
 * be asserting against a row the first one already paid.
 */

/** See `.claude/rules/testing.md` — a bare read of a row just written can be stale. */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: import('@playwright/test').Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_MEMBER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_MEMBER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('a member covers the processing fee and the reservation settles', async ({ page }) => {
	await login(page);

	await page.goto(`/member/reservations/${SEED_RESERVATION_ID}/pay`);

	// The pay form for a balance-due ($15.00) reservation.
	await expect(page.getByText('$15.00').first()).toBeVisible();

	// The boolean field rendered with SvelteKit's `b:` prefix — the exact
	// mechanism the original bug lived in.
	const checkbox = page.locator('input[name="b:coverFees"]');
	await expect(checkbox).toBeVisible();
	await checkbox.check();
	await expect(checkbox).toBeChecked();

	await page.getByRole('button', { name: /^Pay \$/ }).click();

	// The in-app checkout page, reached by the same 303 the live integration
	// issues. Reservations create an `elements` session now, so `checkout()`
	// returns this route directly rather than the fake standing in for a
	// checkout.stripe.com URL — the page is the same either way.
	await expect(page).toHaveURL(/\/checkout\//);
	// $15.00 grossed up for 2.9% + 30¢ — `calculateTotalWithFeeCoverage(1500)` is
	// `{ totalCents: 1576, feeCents: 76 }`. Asserting the total here is what proves
	// the fee line reached the checkout session rather than only the preview.
	await expect(page.getByText('$15.76')).toBeVisible();

	await page.locator('input[name$="cardNumber"]').fill('4242424242424242');
	await page.getByRole('button', { name: /^Pay / }).click();

	// `?paid=` is the session's `return_url`, which only `elements` mode sets —
	// landing on it proves `checkout()` mapped `successUrl` rather than dropping
	// it, and it is what the page polls on while the webhook is in flight.
	await page.waitForURL(/\/member\/reservations\?paid=/, { timeout: 15000 });
	expect(new URL(page.url()).searchParams.get('paid')).toBe(SEED_RESERVATION_ID);

	const readReservation = async () => {
		const [row] = await readLocalDb((db) =>
			db
				.select({
					status: reservation.status,
					paidAt: reservation.paidAt,
					stripePaymentRecordId: reservation.stripePaymentRecordId
				})
				.from(reservation)
				.where(eq(reservation.id, SEED_RESERVATION_ID))
		);
		return row;
	};

	await expect.poll(async () => (await readReservation()).status, DB_POLL).toBe('confirmed');

	const row = await readReservation();
	expect(row.paidAt).not.toBeNull();
	// Written only by `reservation/checkout-listener.ts`, off the domain event the
	// webhook translation emits — so this asserts fulfillment ran, not just that
	// the charge succeeded.
	expect(row.stripePaymentRecordId).not.toBeNull();
});
