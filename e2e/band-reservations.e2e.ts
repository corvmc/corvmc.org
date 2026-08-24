import { expect, test, type Page } from '@playwright/test';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_BANDMATE_EMAIL,
	SEED_BANDMATE_PASSWORD,
	SEED_MEMBERS_BAND_SLUG
} from './fixtures/seed-band-onboarding';

/**
 * Booking the practice space as a band, and the cancel policy around it.
 *
 * The policy is the point: `cancel()` authorizes on `createdByUserId`, so the
 * page used to offer Cancel on every row and answer with an error toast for
 * every bandmate except the one who booked. The server decides now, and sends
 * the answer down as `canCancel` — which is only observable from the outside,
 * hence an e2e rather than another unit test.
 */
async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('a band books a session, and only the booker is offered Cancel', async ({ page }) => {
	await login(page, SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD);
	await page.goto(`/band/${SEED_MEMBERS_BAND_SLUG}/reservations`);

	// Booking is a modal on the list page now, not a /reservations/new route.
	await page.getByRole('button', { name: 'Book a Session' }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible({ timeout: 15000 });

	// DateTimeStep preselects the first bookable day and loads its start times.
	const startTime = dialog.locator('select[name="startTime"]');
	await expect(startTime).toBeEnabled({ timeout: 15000 });
	await startTime.selectOption({ index: 1 });

	const endTime = dialog.locator('select[name="endTime"]');
	await expect(endTime).toBeEnabled({ timeout: 15000 });
	await endTime.selectOption({ index: 1 });

	// The band books but a person is on the hook, so staff need a number to call.
	// The seeded owner has none, which gates the step — same rule as a solo
	// booking, and the reason `step1Valid` won't clear without it.
	const phone = dialog.locator('input[name="phone"]');
	if (await phone.count()) {
		await phone.fill('541-555-0123');
	}

	// `Form.SubmitButton` labels the advance action 'Continue' on every step but
	// the last, where it becomes the step's own label.
	const advance = dialog.getByRole('button', { name: 'Continue' });
	await expect(advance).toBeEnabled({ timeout: 15000 });
	await advance.click();

	// The confirm step must say whose free hours this spends — bands have none of
	// their own, and two bandmates seeing different prices reads as a bug
	// otherwise.
	await expect(dialog.getByText(/Bands don't have their own free hours/)).toBeVisible({
		timeout: 15000
	});

	await dialog.getByRole('button', { name: 'Book Session' }).click();
	await expect(dialog).toBeHidden({ timeout: 20000 });

	// The booking lands on the band's list, visible to the whole band.
	const upcomingRow = page.locator('.card', { hasText: 'Booked by' }).first();
	await expect(upcomingRow).toBeVisible({ timeout: 15000 });
	await expect(upcomingRow.getByRole('button', { name: 'Cancel' })).toBeVisible();

	// A plain member who didn't book sees the session but is offered nothing.
	await page.context().clearCookies();
	await login(page, SEED_BANDMATE_EMAIL, SEED_BANDMATE_PASSWORD);
	await page.goto(`/band/${SEED_MEMBERS_BAND_SLUG}/reservations`);

	const mateRow = page.locator('.card', { hasText: 'Booked by' }).first();
	await expect(mateRow).toBeVisible({ timeout: 15000 });
	await expect(mateRow.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});
