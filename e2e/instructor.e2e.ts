import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_TEACHER_EMAIL,
	SEED_TEACHER_PASSWORD,
	SEED_TEACHER_CONTACT,
	SEED_APPLICANT_EMAIL,
	SEED_APPLICANT_PASSWORD,
	SEED_INSTRUCTOR_HEADLINE,
	SEED_APPLICANT_HEADLINE,
	SEED_APPLICANT_NOTE
} from './fixtures/seed-instructors';

/**
 * Teaching, end to end.
 *
 * Three things here are only observable from outside, which is what earns an e2e
 * over the unit coverage underneath:
 *
 * - the public listing is **unauthenticated**, so the only honest test of it is
 *   a browser with no session;
 * - "Book teaching time" appears for an instructor and for nobody else, which is
 *   a fact about two different users seeing two different pages;
 * - a staff approval moves an application out of the review queue, which spans
 *   two panels and a write.
 */
async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('the teacher directory is public, and shows only approved instructors', async ({ page }) => {
	// No login: the whole point of the route is that the person looking for a
	// teacher is not a member.
	await page.goto('/directory/instructors');

	await expect(page.getByText(SEED_INSTRUCTOR_HEADLINE)).toBeVisible({ timeout: 15000 });
	// The contact is public, so it renders. A members-only one would be withheld
	// here and the card would still show — the case the unit spec pins.
	await expect(page.getByText(SEED_TEACHER_CONTACT)).toBeVisible();

	// The applicant is `requested`, not `active`. Their headline is a real row in
	// the same table, one missing predicate from this page.
	await expect(page.getByText(SEED_APPLICANT_HEADLINE)).toHaveCount(0);
	// And their staff-only note must not be anywhere in the document.
	await expect(page.locator('body')).not.toContainText(SEED_APPLICANT_NOTE);
});

test('an instructor can book teaching time; a member without a grant cannot', async ({ page }) => {
	await login(page, SEED_TEACHER_EMAIL, SEED_TEACHER_PASSWORD);
	await page.goto('/member/reservations');

	const teachingButton = page.getByRole('button', { name: 'Book teaching time' });
	await expect(teachingButton).toBeVisible({ timeout: 15000 });

	await teachingButton.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible({ timeout: 15000 });

	const startTime = dialog.locator('select[name="startTime"]');
	await expect(startTime).toBeEnabled({ timeout: 15000 });
	await startTime.selectOption({ index: 1 });

	const endTime = dialog.locator('select[name="endTime"]');
	await expect(endTime).toBeEnabled({ timeout: 15000 });
	// The first option is a half-hour slot, which `minDurationHours: 1` forbids
	// for a member booking and the teaching terms allow. That difference is the
	// module's reason for a per-booker-type duration floor.
	await endTime.selectOption({ index: 0 });

	const phone = dialog.locator('input[name="phone"]');
	if (await phone.count()) await phone.fill('541-555-0199');

	const advance = dialog.getByRole('button', { name: 'Continue' });
	await expect(advance).toBeEnabled({ timeout: 15000 });
	await advance.click();

	// `ConfirmStep`'s submit is hardcoded 'Book Session' for every booker; the
	// wizard's own label is on the trigger, outside this dialog.
	await dialog.getByRole('button', { name: 'Book Session' }).click();
	await expect(dialog).toBeHidden({ timeout: 20000 });

	// A member with no grant is offered nothing — the button is the visible half
	// of `requireInstructor`, which refuses them on the server regardless.
	await page.context().clearCookies();
	await login(page, SEED_APPLICANT_EMAIL, SEED_APPLICANT_PASSWORD);
	await page.goto('/member/reservations');
	await expect(page.getByRole('button', { name: 'Reserve Space' })).toBeVisible({
		timeout: 15000
	});
	await expect(page.getByRole('button', { name: 'Book teaching time' })).toHaveCount(0);
});

test('staff see a waiting application, and approving it clears the queue', async ({ page }) => {
	await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
	await page.goto('/staff/instructors');

	// Applications lead the page — the only rows on it waiting on staff. Asserted
	// on the visible heading rather than a container class, so the test does not
	// encode `InfoCard`'s markup.
	await expect(page.getByText('Applications')).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(SEED_APPLICANT_HEADLINE)).toBeVisible({ timeout: 15000 });
	// The private half of the application is staff-only, and this is the one
	// surface allowed to render it.
	await expect(page.getByText(SEED_APPLICANT_NOTE)).toBeVisible();

	await page.getByRole('button', { name: 'Approve' }).first().click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await dialog.getByRole('button', { name: 'Approve' }).click();
	await expect(dialog).toBeHidden({ timeout: 20000 });

	// They move from the queue to the roster, which is the whole of the approve
	// transition being observable.
	await expect(page.getByText(SEED_APPLICANT_HEADLINE)).toBeVisible({ timeout: 15000 });
	await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});
