import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_BLOCKED_EVENT_ID,
	SEED_BLOCKED_EVENT_TITLE,
	SEED_READY_EVENT_ID,
	SEED_READY_EVENT_TITLE
} from './fixtures/seed-publish-blockers';

/**
 * A listing that was not ready used to answer the click with a button reading
 * "Error" — the sentence naming what was missing never left the server.
 *
 * Only an e2e sees the whole chain: the query under the staff guard, the
 * blockers in the dialog, the submit gated on them. The component specs mock
 * the remote function.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

// `goto` resolves before the page's awaited remote queries commit, so the
// heading is the gate: without it a negative assertion passes on an empty <main>.
async function openEvent(page: Page, id: string, title: string) {
	await page.goto(`/staff/events/${id}`);
	await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15000 });
}

test('the publish dialog names what the listing is missing, and will not submit', async ({
	page
}) => {
	await loginAsStaff(page);
	await openEvent(page, SEED_BLOCKED_EVENT_ID, SEED_BLOCKED_EVENT_TITLE);

	await page.getByRole('button', { name: 'Publish' }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('Not ready to announce:')).toBeVisible({ timeout: 15000 });
	await expect(dialog.getByText('there is no poster')).toBeVisible();
	await expect(dialog.getByText('there is no description')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Publish' })).toBeDisabled();
});

test('a ready listing gets the plain question and a live submit', async ({ page }) => {
	await loginAsStaff(page);
	await openEvent(page, SEED_READY_EVENT_ID, SEED_READY_EVENT_TITLE);

	await page.getByRole('button', { name: 'Publish' }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('make it visible to the public')).toBeVisible({ timeout: 15000 });
	await expect(dialog.getByText('Not ready to announce:')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Publish' })).toBeEnabled();
});
