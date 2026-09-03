import { expect, test, type Page } from '@playwright/test';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_BANDMATE_EMAIL,
	SEED_BANDMATE_PASSWORD,
	SEED_PUBLIC_BAND_SLUG,
	SEED_MEMBERS_BAND_SLUG
} from './fixtures/seed-band-onboarding';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * A booking enquiry from the public form to the band's inbox, across the seam
 * no unit test spans: a public remote function writes a thread, and an
 * authenticated panel three route roots away reads it.
 *
 * Three rules carry the feature and all three are asserted here —
 *
 *   - the enquiry lands as a thread the band can read, not as an email nobody
 *     has a record of;
 *   - **staff cannot see it.** `staffVisibleThread` is unit-tested against the
 *     predicate it builds; this is the only check that the queue actually
 *     renders without it;
 *   - a plain bandmate cannot either. The nav row is gated, and so is the
 *     route — the nav is decoration, `requireGroupRole` is the guard.
 *
 * What is deliberately not here is *sending* a reply. That calls Postmark, and
 * nothing in this suite has a token; `channel-dispatcher.spec.ts` pins the
 * template, the From name and the signed Reply-To instead. The composer being
 * present and addressed to the right thread is as far as this can honestly go.
 */

const ENQUIRER = 'E2E Booker';
const ENQUIRER_EMAIL = 'e2e.booker@example.com';
const MESSAGE = 'Would you play a Thursday in April? Door split, 40 minute set.';

async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/** The Messages count in the band sidebar; absent entirely when it is zero. */
async function navBadgeCount(page: Page, slug: string): Promise<number> {
	const badge = page.locator(`a[href="/band/${slug}/messages"] .badge`);
	if ((await badge.count()) === 0) return 0;
	return Number((await badge.first().innerText()).trim());
}

test.describe.serial('band booking enquiries', () => {
	test('a stranger’s enquiry reaches the band’s inbox', async ({ page }) => {
		await page.goto(`/directory/bands/${SEED_PUBLIC_BAND_SLUG}`);

		// No address of any kind is published — that is the reason the form exists,
		// and the reason it is the only thing to assert on here.
		await expect(page.locator('body')).not.toContainText('@example.com');

		await page.locator('input[name="name"]').fill(ENQUIRER);
		await page.locator('input[name="email"]').fill(ENQUIRER_EMAIL);
		await page.locator('textarea[name="message"]').fill(MESSAGE);

		// Wait for Cloudflare's widget to write its token before submitting. The
		// input does not exist until the challenge script has loaded and rendered
		// — it is created by `window.turnstile.render`, not by the markup — so a
		// click before then submits without it. That is a real thing a user can do
		// and the form now says so, but it is not what this test is about.
		//
		// The field name is `TURNSTILE_RESPONSE_FIELD` from `src/lib/turnstile.ts`,
		// spelled out rather than imported: that module reads `$env/dynamic/public`,
		// which does not resolve outside the SvelteKit build.
		await expect(page.locator('input[name="turnstileToken"]')).not.toHaveValue('', {
			timeout: 30000
		});

		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.getByText('Sent.')).toBeVisible({ timeout: 15000 });

		// Now the other side of it.
		await login(page, SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD);
		await page.goto(`/band/${SEED_PUBLIC_BAND_SLUG}`);

		// Unread from the dashboard, before the inbox is even opened: the badge is
		// what makes an unanswered enquiry visible from anywhere in the panel.
		await expect
			.poll(() => navBadgeCount(page, SEED_PUBLIC_BAND_SLUG), { timeout: 15000 })
			.toBeGreaterThan(0);

		await page.goto(`/band/${SEED_PUBLIC_BAND_SLUG}/messages`);
		const row = page.getByRole('listitem').filter({ hasText: ENQUIRER });
		await expect(row).toBeVisible({ timeout: 15000 });

		await row.click();
		await expect(page.getByText(MESSAGE)).toBeVisible({ timeout: 15000 });
		// The reply box, addressed at this thread. Sending it is Postmark's job.
		await expect(page.getByRole('button', { name: 'Send Reply' })).toBeVisible();

		// Opening it is what marks it read.
		await expect.poll(() => navBadgeCount(page, SEED_PUBLIC_BAND_SLUG), { timeout: 15000 }).toBe(0);
	});

	test('staff cannot see it, in any view or filter', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);

		for (const view of ['open', 'snoozed', 'resolved', 'all']) {
			await page.goto(`/staff/inbox?view=${view}`);
			// Waiting on the list itself, so the negative assertion cannot pass
			// against a pane that has not rendered yet.
			await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 15000 });
			await expect(page.getByRole('listitem').filter({ hasText: ENQUIRER })).toHaveCount(0);
		}

		// And not by search, which LIKEs the preview — the enquiry's own words.
		await page.goto(`/staff/inbox?q=${encodeURIComponent(ENQUIRER)}`);
		await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole('listitem').filter({ hasText: ENQUIRER })).toHaveCount(0);
	});

	test('a plain bandmate is offered neither the row nor the route', async ({ page }) => {
		await login(page, SEED_BANDMATE_EMAIL, SEED_BANDMATE_PASSWORD);

		await page.goto(`/band/${SEED_MEMBERS_BAND_SLUG}`);
		await expect(page.locator(`a[href="/band/${SEED_MEMBERS_BAND_SLUG}/messages"]`)).toHaveCount(0);

		// The nav is decoration; this is the guard.
		await page.goto(`/band/${SEED_MEMBERS_BAND_SLUG}/messages`);
		await expect(page.getByText(/Insufficient permissions|403/i)).toBeVisible({ timeout: 15000 });
	});
});
