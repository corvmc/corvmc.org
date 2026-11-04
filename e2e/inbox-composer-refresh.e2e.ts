import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import { SEED_NEEDS_REPLY_THREAD_ID } from './fixtures/seed-inbox-awaiting';
import { fakeNotificationStream, notify } from './fixtures/notification-stream';

/**
 * A notification arriving while a reply is half-written. The bell's
 * `invalidateAll()` refreshes every query on the page, and the composer has to
 * come through that with the draft intact (#2357).
 */
test('a notification does not wipe a half-written reply', async ({ page }) => {
	await fakeNotificationStream(page);
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
	await page.goto(`/staff/inbox/${SEED_NEEDS_REPLY_THREAD_ID}`);

	const body = page.locator('textarea:is([name="body"], [name^="body/"])');
	await body.fill('half-written reply');

	const refreshed = page.waitForResponse((r) => r.url().includes('/getInboxEnabledChannels'));
	await notify(page);
	await refreshed;

	await expect(body).toHaveValue('half-written reply');
});
