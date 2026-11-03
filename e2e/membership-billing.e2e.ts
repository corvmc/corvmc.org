import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { eq } from 'drizzle-orm';
import { readLocalDb } from './fixtures/platform-db';
import { user } from '../src/lib/server/db/schema/authentication';
import {
	SEED_BILLING_EMAIL,
	SEED_BILLING_PASSWORD,
	SEED_BILLING_USER_ID
} from './fixtures/seed-membership-billing';

/**
 * Managing the card on file, on our own page.
 *
 * This was Stripe's billing portal until phase 6 — another origin no test could
 * follow into — so none of it had coverage. Under `fake` the round trip runs
 * with no network: SetupIntent → attach → default → detach. What it cannot
 * reach: `docs/specs/shipped/finance-spec.md#testing`.
 */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: Page) {
	await signInAs(page, { email: SEED_BILLING_EMAIL, password: SEED_BILLING_PASSWORD });
}

/** The card list's own rows, by the last four digits each one shows. */
const cardRow = (page: Page, last4: string) =>
	page.getByTestId('payment-methods').locator('li').filter({ hasText: last4 });

async function addCard(page: Page, cardNumber: string) {
	// The add button sits below the list, so it is the card's last button.
	await page.getByTestId('payment-methods').getByRole('button').last().click();
	// The SetupIntent is minted when the modal opens, so the form is not there
	// until that round trip lands.
	const dialog = page.getByRole('dialog');
	await expect(dialog.locator('input[name$="cardNumber"]')).toBeVisible({ timeout: 15000 });
	await dialog.locator('input[name$="cardNumber"]').fill(cardNumber);
	await dialog.locator('button[type=submit]').click();
}

const readCardOnUser = async () => {
	const [row] = await readLocalDb((db) =>
		db
			.select({ pmType: user.pmType, pmLastFour: user.pmLastFour })
			.from(user)
			.where(eq(user.id, SEED_BILLING_USER_ID))
	);
	return row;
};

test('a member adds, defaults and removes a card without leaving the site', async ({ page }) => {
	await login(page);
	await page.goto('/member/membership');

	// The section that replaced the portal link. Nothing is on file yet: the
	// seeded customer is a `cus_seed_…` the fake has never been asked about.
	const methods = page.getByTestId('payment-methods');
	await expect(methods).toBeVisible();
	await expect(methods.getByRole('button')).toHaveCount(1);
	await expect(methods.getByRole('alert')).toHaveCount(0);
	await expect(methods.locator('li')).toHaveCount(0);

	await addCard(page, '4242424242424242');

	await expect(cardRow(page, '4242')).toBeVisible({ timeout: 15000 });
	// No subscription lives in the fake gateway for this customer, so there is
	// nothing to point at the card — but it is still theirs, and still the one to
	// remember. That mirroring is what lets a page name the card with no Stripe
	// call, and it had no writer before this phase.
	await expect.poll(async () => (await readCardOnUser())?.pmLastFour, DB_POLL).toBe('4242');
	expect((await readCardOnUser())?.pmType).toBe('visa');

	// A second card, so the first can be removed — the last card on a live
	// subscription is refused, and this is the path that proves the list is real
	// rather than a single mirrored row.
	await addCard(page, '5555555555554444');
	await expect(cardRow(page, '4444')).toBeVisible({ timeout: 15000 });
	await expect(methods.locator('li')).toHaveCount(2);

	// Remove the first one: its row's last button. `Action` opens a confirm
	// modal, so the click that matters is the one inside it, which comes last.
	await cardRow(page, '4242').getByRole('button').last().click();
	await page.getByRole('dialog').getByRole('button').last().click();

	await expect(cardRow(page, '4242')).toHaveCount(0, { timeout: 15000 });
	await expect(cardRow(page, '4444')).toBeVisible();
	await expect(methods.locator('li')).toHaveCount(1);
});

test('the membership page renders even though billing is a separate query', async ({ page }) => {
	await login(page);
	await page.goto('/member/membership');

	// The portal link this replaced sat inside `getMemberMembership`'s own
	// Promise.all, so a Stripe failure took the page down for every sustaining
	// member. Both are on screen together now, which is what proves the billing
	// section is loaded beside the page rather than inside it.
	await expect(page.getByTestId('contribution')).toBeVisible();
	await expect(page.getByTestId('billing-history')).toBeVisible();

	// And the portal itself is gone: nothing in either card links off the site.
	for (const card of ['contribution', 'payment-methods']) {
		await expect(page.getByTestId(card).locator('a:not([href^="/"])')).toHaveCount(0);
	}
});
