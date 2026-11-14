import { expect, test } from './fixtures/test';
import {
	SEED_TEACHER_CONTACT,
	SEED_INSTRUCTOR_HEADLINE,
	SEED_APPLICANT_HEADLINE,
	SEED_APPLICANT_NOTE
} from './fixtures/seed-instructors';

/**
 * The public teacher listing is unauthenticated, so the only honest test of it
 * is a browser with no session. Booking teaching time and approving an
 * application are pinned in `reservations.remote.member-page.spec.ts`,
 * `DateTimeStep.svelte.spec.ts` and `instructor-service.spec.ts`.
 */
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
