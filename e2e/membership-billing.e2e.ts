import { expect, test } from '@playwright/test';
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
 * Until phase 6 this was Stripe's billing portal — another origin, which no
 * test could follow into, and which the fake driver answered with a URL
 * fragment that went nowhere. There was consequently no coverage of adding,
 * defaulting or removing a card at all, because there was no card management in
 * this app to cover.
 *
 * Under `PAYMENTS_DRIVER=fake` the modal renders a card-number form instead of
 * Stripe's Setup Element and the attachment happens server-side, so the whole
 * round trip runs with no network: SetupIntent → attach → default → detach.
 * What the fake cannot exercise is `confirmSetup` in the browser, which needs a
 * sandbox key and a manual pass.
 *
 * The `pmType` / `pmLastFour` read-back goes through `readLocalDb` (read-only):
 * those columns are the contract between this flow and every surface that names
 * the card without a Stripe call, and they had no writer at all before this.
 */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: import('@playwright/test').Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_BILLING_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_BILLING_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

async function addCard(page: import('@playwright/test').Page, cardNumber: string) {
	await page.getByRole('button', { name: /Add (a|another) card/ }).click();
	// The SetupIntent is minted when the modal opens, so the form is not there
	// until that round trip lands.
	await expect(page.locator('input[name$="cardNumber"]')).toBeVisible({ timeout: 15000 });
	await page.locator('input[name$="cardNumber"]').fill(cardNumber);
	await page.getByRole('button', { name: /^Save card/ }).click();
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
	await expect(page.getByRole('heading', { name: 'Payment Methods' })).toBeVisible();
	await expect(page.getByText('No card saved yet.')).toBeVisible();

	await addCard(page, '4242424242424242');

	await expect(page.getByText('•••• 4242')).toBeVisible({ timeout: 15000 });
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
	await expect(page.getByText('•••• 4444')).toBeVisible({ timeout: 15000 });

	// Remove the first one. `Action` opens a confirm modal, so the click that
	// matters is the one inside it.
	const firstRow = page.locator('li', { hasText: '•••• 4242' });
	await firstRow.getByRole('button', { name: 'Remove' }).click();
	await page
		.getByRole('button', { name: /^Remove$/ })
		.last()
		.click();

	await expect(page.getByText('•••• 4242')).toHaveCount(0, { timeout: 15000 });
	await expect(page.getByText('•••• 4444')).toBeVisible();
});

test('the membership page renders even though billing is a separate query', async ({ page }) => {
	await login(page);
	await page.goto('/member/membership');

	// The portal link this replaced sat inside `getMemberMembership`'s own
	// Promise.all, so a Stripe failure took the page down for every sustaining
	// member. Both are on screen together now, which is what proves the billing
	// section is loaded beside the page rather than inside it.
	await expect(page.getByRole('heading', { name: 'Your Contribution' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Billing History' })).toBeVisible();

	// And the portal itself is gone.
	await expect(page.getByRole('link', { name: 'Manage Billing' })).toHaveCount(0);
});
