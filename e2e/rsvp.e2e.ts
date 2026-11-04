import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { eventRsvp } from '../src/lib/server/db/schema/event-rsvp';
import { readLocalDb } from './fixtures/platform-db';
import {
	SEED_RSVP_EVENT_ID,
	SEED_RSVP_EVENT_TITLE,
	SEED_RSVP_MEMBER_EMAIL,
	SEED_RSVP_MEMBER_ID,
	SEED_RSVP_MEMBER_PASSWORD
} from './fixtures/seed-rsvp';

/**
 * A signed-out visitor RSVPs from the event page (#1995): the button is the
 * sign-in interrupt (#1999), sign-in returns to the event, and one tap there
 * finishes it. Nothing is written until that tap.
 */

const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };
const eventPath = `/events/${SEED_RSVP_EVENT_ID}`;

async function rsvpCount(): Promise<number> {
	const rows = await readLocalDb((db) =>
		db
			.select({ id: eventRsvp.id })
			.from(eventRsvp)
			.where(
				and(eq(eventRsvp.eventId, SEED_RSVP_EVENT_ID), eq(eventRsvp.userId, SEED_RSVP_MEMBER_ID))
			)
	);
	return rows.length;
}

test('a signed-out visitor signs in from the RSVP button and lands one tap from going', async ({
	page
}) => {
	await page.goto(eventPath);
	// Strict: the title is one heading (#2007), and a second would fail this locator.
	await expect(page.getByRole('heading', { name: SEED_RSVP_EVENT_TITLE })).toBeVisible();

	// Signed out, the RSVP is a link to sign-in that carries the way back and
	// the intent; it is the page's only sign-in link that carries one.
	await page.locator('a[href^="/login?"][href*="intent="]').click();
	await expect(page).toHaveURL(/\/login\?/);
	const url = new URL(page.url());
	expect(url.searchParams.get('redirect')).toBe(eventPath);
	expect(url.searchParams.get('intent')).toContain(SEED_RSVP_EVENT_TITLE);
	await expect(page.locator('.alert-info')).toBeVisible();

	await page.locator('input:is([name="email"], [name^="email/"])').fill(SEED_RSVP_MEMBER_EMAIL);
	await page
		.locator('input:is([name="password"], [name^="password/"])')
		.fill(SEED_RSVP_MEMBER_PASSWORD);
	// The sign-in form is the one with a password field.
	await page
		.locator('form:has(input:is([name="password"], [name^="password/"])) button[type="submit"]')
		.click();

	// Back on the event, signed in, and nothing written yet.
	await expect(page).toHaveURL(new RegExp(`${eventPath}$`));
	const confirm = page.locator(
		'form:has(input:is([name="eventId"], [name^="eventId/"])) button[type="submit"]'
	);
	await expect(confirm).toBeEnabled();
	expect(await rsvpCount()).toBe(0);

	await confirm.click();
	await expect(page.getByTestId('rsvp-going')).toBeVisible();
	await expect.poll(rsvpCount, DB_POLL).toBe(1);
});
