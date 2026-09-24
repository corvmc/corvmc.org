import { test, expect, type Page } from '@playwright/test';
import { expectSuccessToast } from './toast';
import {
	SEED_BALLOT_OPEN_ID,
	SEED_BALLOT_CLOSED_ID,
	SEED_BALLOT_CLOSED_TITLE,
	readSecretTally,
	readCertifiedAt
} from './fixtures/seed-ballots';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Formal balloting end to end: a secret vote lands as one participation row
 * and one counter increment, and the named certifier publishes a closed result.
 */

const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, DB_POLL);
}

test('a secret vote is counted once and cannot be cast again', async ({ page }) => {
	await login(page);
	await page.goto(`/member/ballots/${SEED_BALLOT_OPEN_ID}`);

	await page.getByRole('combobox', { name: 'Your choice' }).selectOption({ label: 'Yes' });
	await page.getByRole('button', { name: 'Cast my vote' }).click();
	await expectSuccessToast(page);

	await expect
		.poll(() => readSecretTally(SEED_BALLOT_OPEN_ID), DB_POLL)
		.toEqual({ participation: 1, counted: 1 });
	await expect(page.getByRole('button', { name: 'Cast my vote' })).toHaveCount(0);
});

test('the certifier publishes a closed result', async ({ page }) => {
	await login(page);
	await page.goto(`/member/ballots/${SEED_BALLOT_CLOSED_ID}`);
	await expect(
		page.getByRole('heading', { level: 1, name: SEED_BALLOT_CLOSED_TITLE })
	).toBeVisible();

	await page.getByRole('button', { name: 'Certify the result' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Certify' }).click();
	await expectSuccessToast(page);

	await expect.poll(() => readCertifiedAt(SEED_BALLOT_CLOSED_ID), DB_POLL).not.toBeNull();
	await expect(page.getByRole('cell', { name: 'Yes' })).toBeVisible();
});
