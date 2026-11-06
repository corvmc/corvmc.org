import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import { expectSuccessToast } from './toast';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Closures and recurring series folded into Reservations (#1833, #1936): the
 * old pages redirect, and a closure made from the header shows up as a row.
 */

// The bell's stream, held in the test's hand: a `message` makes the bell call
// `refreshAll()`, which is when a notification lands under an open dialog.
async function fakeNotificationStream(page: Page) {
	await page.addInitScript(() => {
		const open: EventTarget[] = [];
		class FakeEventSource extends EventTarget {
			onerror: ((e: Event) => void) | null = null;
			constructor() {
				super();
				open.push(this);
			}
			close() {}
		}
		Object.assign(window, {
			EventSource: FakeEventSource,
			__notificationStreams: open,
			__notify: () => open.forEach((s) => s.dispatchEvent(new MessageEvent('message')))
		});
	});
}

async function loginAsStaff(page: Page) {
	await signInAs(page, { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD });
}

test.describe('reservations timeline', () => {
	test('a closure made from the header is a row of the list', async ({ page }) => {
		await fakeNotificationStream(page);
		await loginAsStaff(page);
		await page.goto('/staff/closures');
		await page.waitForURL(/\/staff\/reservations\?show=closures/, { timeout: 15000 });

		// Far enough out that it blocks no slot another spec books.
		const reason = `E2E closure ${Date.now()}`;
		const start = { entered: '09:00', shown: '9:00' };
		await page.getByTestId('new-closure').click();
		const dialog = page
			.getByRole('dialog')
			.filter({ has: page.locator('input:is([name="reason"], [name^="reason/"])') });
		await dialog.locator('input:is([name="reason"], [name^="reason/"])').fill(reason);
		await dialog
			.locator('input:is([name="startsAt"], [name^="startsAt/"])')
			.fill(`2099-01-05T${start.entered}`);
		await dialog.locator('input:is([name="endsAt"], [name^="endsAt/"])').fill('2099-01-05T17:00');

		// #2350: the refresh a notification causes unmounted the open dialog.
		await page.waitForFunction(
			() =>
				(window as unknown as { __notificationStreams: unknown[] }).__notificationStreams.length > 0
		);
		const refreshed = page.waitForResponse((r) => r.url().includes('/getStaffReservationsPage'));
		await page.evaluate(() => (window as unknown as { __notify: () => void }).__notify());
		await refreshed;
		await expect(dialog.locator('input:is([name="reason"], [name^="reason/"])')).toHaveValue(
			reason
		);

		await dialog.locator('button[type="submit"]').click();
		await expectSuccessToast(page);

		await page.getByRole('searchbox').fill(reason);
		const row = page.getByRole('row').filter({ hasText: reason });
		// A closure row, not a booking: the error badge is the closure's marker.
		await expect(row.locator('.badge-error')).toBeVisible();
		await expect(row).toContainText(start.shown);

		// #2352: DataList's rows, and a row action's open dialog, remounted on a refresh too.
		await row.getByTestId('edit-closure').click();
		const edit = page
			.getByRole('dialog')
			.filter({ has: page.locator('input:is([name="reason"], [name^="reason/"])') });
		const edited = `${reason} edited`;
		await edit.locator('input:is([name="reason"], [name^="reason/"])').fill(edited);
		const rowRefreshed = page.waitForResponse((r) => r.url().includes('/getStaffReservationsPage'));
		await page.evaluate(() => (window as unknown as { __notify: () => void }).__notify());
		await rowRefreshed;
		await expect(edit.locator('input:is([name="reason"], [name^="reason/"])')).toHaveValue(edited);
	});

	test('the old recurring address opens the series modal', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/recurring');
		await page.waitForURL(/\/staff\/reservations\?recurring/, { timeout: 15000 });
		// The only modal `?recurring` opens.
		await expect(page.getByRole('dialog')).toBeVisible();
	});
});
