import { expect, test, type Page } from '@playwright/test';
import { like } from 'drizzle-orm';
import { verification } from '../src/lib/server/db/schema/authentication';
import { readLocalDb } from './fixtures/platform-db';
import {
	SEED_RESET_EMAIL,
	SEED_RESET_NEW_PASSWORD,
	SEED_RESET_PASSWORD
} from './fixtures/seed-password-reset';

/**
 * A forgotten password, all the way back to a signed-in session.
 *
 * There is no mail catcher in this suite, and the preview server has no
 * POSTMARK_SERVER_TOKEN, so the send fails there by design — `afterResponse`
 * captures it and the request succeeds regardless, which is exactly what the
 * flow promises. The token is therefore read back out of the `verification`
 * table rather than out of an inbox; what the email would have carried is
 * covered in `src/lib/server/auth-emails.spec.ts`.
 *
 * This spec changes a password, so it uses an account nothing else touches
 * (`seed-password-reset.ts`). The fixture reseeds the credential and clears the
 * request's KV counters on every run.
 */

/** `readLocalDb` reads a file the server is still writing; never a bare read. */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The newest live reset token, or null while the write is still in flight. */
async function latestResetToken(): Promise<string | null> {
	const rows = await readLocalDb((db) =>
		db
			.select({ identifier: verification.identifier, expiresAt: verification.expiresAt })
			.from(verification)
			.where(like(verification.identifier, 'reset-password:%'))
	);
	const newest = rows.sort((a, b) => Number(b.expiresAt) - Number(a.expiresAt))[0];
	return newest ? newest.identifier.replace('reset-password:', '') : null;
}

test('a member who has forgotten their password can set a new one and sign in', async ({
	page
}) => {
	// The link off the sign-in form is the only way most people will find this.
	await page.goto('/login');
	await page.getByRole('link', { name: /forgot your password/i }).click();
	await page.waitForURL(/\/forgot-password/);

	await page.locator('input[name="email"]').fill(SEED_RESET_EMAIL);
	await page.getByRole('button', { name: /send reset link/i }).click();

	// Says nothing about whether the address exists — the same copy an unknown
	// address gets.
	await expect(page.getByText(/if that address has an account/i)).toBeVisible();

	// Poll first — `readLocalDb` opens the file the preview server is still
	// writing through workerd, so the page having moved on does not establish
	// that a fresh reader can see the row yet.
	await expect.poll(() => latestResetToken(), DB_POLL).not.toBeNull();
	const token = await latestResetToken();

	// better-auth's own callback validates the token, then redirects to our page
	// with it in the query string. Walking it is what the emailed link does.
	await page.goto(`/api/auth/reset-password/${token}?callbackURL=%2Freset-password`);
	await page.waitForURL(/\/reset-password\?token=/);

	await page.locator('input[name="newPassword"]').fill(SEED_RESET_NEW_PASSWORD);
	await page.locator('input[name="confirmPassword"]').fill(SEED_RESET_NEW_PASSWORD);
	await page.getByRole('button', { name: /set password/i }).click();

	await expect(page.getByText(/your password has been changed/i)).toBeVisible();

	// The point of the whole exercise.
	await login(page, SEED_RESET_EMAIL, SEED_RESET_NEW_PASSWORD);
	await page.waitForURL(/\/member(\/|$|\?)/);

	// And the old one is gone, not merely superseded. The copy appears twice —
	// the alert and its live region — so `.first()`; what actually matters is
	// that the page never left /login.
	await page.context().clearCookies();
	await login(page, SEED_RESET_EMAIL, SEED_RESET_PASSWORD);
	await expect(page.getByText(/invalid email or password/i).first()).toBeVisible();
	await expect(page).toHaveURL(/\/login/);

	// The token was consumed by the reset, so the same link is now a dead end.
	await page.goto(`/api/auth/reset-password/${token}?callbackURL=%2Freset-password`);
	await expect(page.getByText(/expired or has already been used/i)).toBeVisible();
});

test('an unknown address gets the same answer as a real one', async ({ page }) => {
	await page.goto('/forgot-password');
	await page.locator('input[name="email"]').fill('nobody.at.all@example.com');
	await page.getByRole('button', { name: /send reset link/i }).click();

	await expect(page.getByText(/if that address has an account/i)).toBeVisible();
});

test('a reset link with no token is a dead end, not an empty form', async ({ page }) => {
	await page.goto('/reset-password?error=INVALID_TOKEN');

	await expect(page.getByText(/expired or has already been used/i)).toBeVisible();
	await expect(page.locator('input[name="newPassword"]')).toHaveCount(0);
});
