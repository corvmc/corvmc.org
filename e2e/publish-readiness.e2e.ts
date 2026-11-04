import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './fixtures/auth';
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
 * warnings in the dialog, the reason it asks for before publishing anyway. The component specs mock
 * the remote function.
 */

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

// `goto` resolves before the page's awaited remote queries commit, so the
// heading is the gate: without it a negative assertion passes on an empty <main>.
async function openEvent(page: Page, id: string, title: string) {
	await page.goto(`/staff/events/${id}`);
	await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15000 });
}

test('the publish dialog names what the listing is missing, and asks why before publishing anyway', async ({
	page
}) => {
	await loginAsStaff(page);
	await openEvent(page, SEED_BLOCKED_EVENT_ID, SEED_BLOCKED_EVENT_TITLE);

	await page.getByTestId('publish-event').click();

	const dialog = page.getByRole('dialog');
	// The seed leaves out the poster and the description, and nothing else.
	await expect(dialog.getByRole('alert').locator('li')).toHaveCount(2, { timeout: 15000 });
	await expect(dialog.getByLabel('Why publish now?')).toBeVisible();
	await expect(dialog.locator('button[type="submit"]')).toBeEnabled();
});

test('a ready listing gets the plain question and a live submit', async ({ page }) => {
	await loginAsStaff(page);
	await openEvent(page, SEED_READY_EVENT_ID, SEED_READY_EVENT_TITLE);

	await page.getByTestId('publish-event').click();

	const dialog = page.getByRole('dialog');
	await expect(dialog.locator('button[type="submit"]')).toBeEnabled({ timeout: 15000 });
	// Nothing to warn about, so no list of blockers and no reason to give.
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog.locator('textarea:is([name="reason"], [name^="reason/"])')).toHaveCount(0);
});
