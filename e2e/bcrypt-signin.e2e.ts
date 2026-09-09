import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { account } from '../src/lib/server/db/schema/authentication';
import { readLocalDb } from './fixtures/platform-db';
import {
	SEED_BCRYPT_EMAIL,
	SEED_BCRYPT_ID,
	SEED_BCRYPT_PASSWORD
} from './fixtures/seed-bcrypt-signin';

/**
 * A member whose password is still stored the way Laravel stored it.
 *
 * Runs against a real workerd with `LARAVEL_URL` pinned empty, so a pass means
 * the `$2*` hash was verified inside the Worker rather than by the Forge box.
 * A regression here is 93 production accounts unable to sign in (#623).
 */

/** `readLocalDb` reads a file the server is still writing; never a bare read. */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

async function storedHash(): Promise<string | null> {
	const rows = await readLocalDb((db) =>
		db
			.select({ password: account.password })
			.from(account)
			.where(eq(account.userId, SEED_BCRYPT_ID))
	);
	return rows[0]?.password ?? null;
}

test('a member on a legacy bcrypt password signs in, and the hash retires', async ({ page }) => {
	expect(await storedHash()).toMatch(/^\$2/);

	await login(page, SEED_BCRYPT_EMAIL, SEED_BCRYPT_PASSWORD);
	await page.waitForURL(/\/member(\/|$|\?)/);

	// One successful sign-in is the migration: the bcrypt hash is replaced with
	// scrypt on the way through, which is how the legacy set only ever shrinks.
	await expect.poll(storedHash, DB_POLL).toMatch(/^scrypt:/);
});

test('a wrong password on a legacy account is still refused', async ({ page }) => {
	await login(page, SEED_BCRYPT_EMAIL, 'definitely not the password');

	// The copy appears twice — the alert and its live region — so `.first()`.
	await expect(page.getByText(/invalid email or password/i).first()).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
});
