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
	await page.locator('input:is([name="email"], [name^="email/"])').fill(email);
	await page.locator('input:is([name="password"], [name^="password/"])').fill(password);
	// The sign-in form is the one with a password field.
	await page
		.locator('form:has(input:is([name="password"], [name^="password/"])) button[type="submit"]')
		.click();
}

async function requestLink(page: Page) {
	await page
		.locator('form:has(input:is([name="email"], [name^="email/"])) button[type="submit"]')
		.click();
}

/** Requested: the form gives way to the success alert, whoever the address is. */
async function expectLinkRequested(page: Page) {
	await expect(page.locator('.card .alert-success')).toBeVisible();
	await expect(page.locator('input:is([name="email"], [name^="email/"])')).toHaveCount(0);
}

/** A dead link: the error alert, and the way on is to ask for a new link. */
async function expectDeadLink(page: Page) {
	await expect(page.locator('.card .alert-error')).toBeVisible();
	await expect(page.locator('.card a.btn[href="/forgot-password"]')).toBeVisible();
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
	await page.locator('a[href="/forgot-password"]').click();
	await page.waitForURL(/\/forgot-password/);

	await page.locator('input:is([name="email"], [name^="email/"])').fill(SEED_RESET_EMAIL);
	await requestLink(page);

	// Says nothing about whether the address exists — the same answer an
	// unknown address gets.
	await expectLinkRequested(page);

	// Poll first — `readLocalDb` opens the file the preview server is still
	// writing through workerd, so the page having moved on does not establish
	// that a fresh reader can see the row yet.
	await expect.poll(() => latestResetToken(), DB_POLL).not.toBeNull();
	const token = await latestResetToken();

	// better-auth's own callback validates the token, then redirects to our page
	// with it in the query string. Walking it is what the emailed link does.
	await page.goto(`/api/auth/reset-password/${token}?callbackURL=%2Freset-password`);
	await page.waitForURL(/\/reset-password\?token=/);

	await page
		.locator('input:is([name="newPassword"], [name^="newPassword/"])')
		.fill(SEED_RESET_NEW_PASSWORD);
	await page
		.locator('input:is([name="confirmPassword"], [name^="confirmPassword/"])')
		.fill(SEED_RESET_NEW_PASSWORD);
	await page
		.locator(
			'form:has(input:is([name="newPassword"], [name^="newPassword/"])) button[type="submit"]'
		)
		.click();

	// Done: the form gives way to the success alert and a way back to sign in.
	await expect(page.locator('.card .alert-success')).toBeVisible();
	await expect(page.locator('.card a.btn[href="/login"]')).toBeVisible();
	await expect(page.locator('input:is([name="newPassword"], [name^="newPassword/"])')).toHaveCount(
		0
	);

	// The point of the whole exercise.
	await login(page, SEED_RESET_EMAIL, SEED_RESET_NEW_PASSWORD);
	await page.waitForURL(/\/member(\/|$|\?)/);

	// And the old one is gone, not merely superseded: the form's error alert,
	// and the page never leaves /login.
	await page.context().clearCookies();
	await login(page, SEED_RESET_EMAIL, SEED_RESET_PASSWORD);
	await expect(page.locator('.alert-error[role="alert"]').first()).toBeVisible();
	await expect(page).toHaveURL(/\/login/);

	// The token was consumed by the reset, so the same link is now a dead end.
	await page.goto(`/api/auth/reset-password/${token}?callbackURL=%2Freset-password`);
	await expectDeadLink(page);
});

test('an unknown address gets the same answer as a real one', async ({ page }) => {
	await page.goto('/forgot-password');
	await page
		.locator('input:is([name="email"], [name^="email/"])')
		.fill('nobody.at.all@example.com');
	await requestLink(page);

	await expectLinkRequested(page);
});

test('a reset link with no token is a dead end, not an empty form', async ({ page }) => {
	await page.goto('/reset-password?error=INVALID_TOKEN');

	await expectDeadLink(page);
	await expect(page.locator('input:is([name="newPassword"], [name^="newPassword/"])')).toHaveCount(
		0
	);
});
