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
	// The title renders as two headings (#2007); any visible one proves the page loaded.
	await expect(
		page.getByRole('heading', { name: SEED_RSVP_EVENT_TITLE }).filter({ visible: true }).first()
	).toBeVisible();

	// Signed out, the RSVP is a link to sign-in that carries the way back.
	await page.getByRole('link', { name: 'RSVP', exact: true }).click();
	await expect(page).toHaveURL(/\/login\?/);
	const url = new URL(page.url());
	expect(url.searchParams.get('redirect')).toBe(eventPath);
	await expect(page.getByText(`RSVP to ${SEED_RSVP_EVENT_TITLE}`)).toBeVisible();

	await page.locator('input[name="email"]').fill(SEED_RSVP_MEMBER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_RSVP_MEMBER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();

	// Back on the event, signed in, and nothing written yet.
	await expect(page).toHaveURL(new RegExp(`${eventPath}$`));
	const confirm = page.getByRole('button', { name: 'RSVP', exact: true });
	await expect(confirm).toBeEnabled();
	expect(await rsvpCount()).toBe(0);

	await confirm.click();
	await expect(page.getByTestId('rsvp-going')).toHaveText("You're going!");
	await expect.poll(rsvpCount, DB_POLL).toBe(1);
});
