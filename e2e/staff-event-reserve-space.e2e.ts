import { expect, test, type Page } from '@playwright/test';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	bookingDate,
	SEED_CONFLICT_DATE,
	SEED_CONFLICT_END,
	SEED_CONFLICT_START,
	SEED_EVENT_DATE,
	SEED_EVENT_END,
	SEED_EVENT_START,
	SEED_EVENT_TITLE_PREFIX,
	SEED_EDIT_EVENT_DATE,
	SEED_SELF_CONFLICT_DATE,
	SEED_LIST_LINK_DATE
} from './fixtures/seed-staff-event';

/**
 * End-to-end pin for the "Reserve practice space" toggle on the New Event modal.
 *
 * The toggle's value was passed one-way (`value=` rather than `bind:value=`) to
 * FormField, whose checkbox owns the binding. The parent's `reserveSpace` never
 * flipped, so the conditional block holding the reservation times never mounted
 * and never submitted — and the server, which only booked the space when both
 * times arrived, created the event with no reservation and no error.
 *
 * This is the same FormField binding defect class documented in
 * staff-users.e2e.ts; only an e2e catches it, because the server handler tests
 * post the fields the browser was failing to render.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_STAFF_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/**
 * Wait for a create or edit submission to land on the event's own page.
 *
 * `waitForURL` on its own is not that, and assuming it was is what made this
 * file flake on CI. `handleSuccess` navigates with `goto()`, which commits the
 * URL as soon as the route's (empty) load resolves — the page's data is fetched
 * by the component afterwards, and Svelte commits the whole tree in one batch,
 * so the events *list* is still what is on screen when `waitForURL` returns.
 *
 * Everything after that point is therefore still waiting for a page to load,
 * which is not what Playwright's implicit 5s expect budget is for. The rest of
 * this file already spends 15s on its post-navigation assertions; these are the
 * two that did not, and they are the two that went red.
 */
async function waitForEventPage(page: Page, title: string) {
	await page.waitForURL(/\/staff\/events\/[^/]+$/, { timeout: 15000 });
	await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15000 });
}

// A checkbox Field carries the `b:` prefix so SvelteKit submits a real boolean.
const RESERVE_TOGGLE = 'input[name="b:reserveSpace"]';

// The window and title prefix come from the fixture, which clears the previous
// run's event first — its reservation would otherwise conflict with this one.
//
// That sweep runs once per *run*, though, and CI retries a failed test twice.
// Every test below that submits a hold therefore draws its day from
// `bookingDate(base, retry)` rather than booking the base day three times: a
// test may not write to the state directory the preview server holds, so a
// retry cannot clear the hold the attempt before it raised, and re-booking the
// same window is rejected as a genuine double-booking. Uniquifying the title
// with `Date.now()` is not enough — the *slot* is what collides.
const EVENT_DATE = SEED_EVENT_DATE;
const EVENT_START = SEED_EVENT_START;
const EVENT_END = SEED_EVENT_END;

test.describe('staff event creation — reserve space', () => {
	test('checking the toggle reveals the reservation times, pre-filled from the event', async ({
		page
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'New Event' }).click();

		await page.locator('input[name="eventStartTime"]').fill(EVENT_START);
		await page.locator('input[name="eventEndTime"]').fill(EVENT_END);

		// Before the fix these never mounted, so the times were never submitted.
		await expect(page.locator('input[name="reservationStartTime"]')).toHaveCount(0);

		await page.locator(RESERVE_TOGGLE).check();

		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue(EVENT_START);
		await expect(page.locator('input[name="reservationEndTime"]')).toHaveValue(EVENT_END);
	});

	test('creating the event books the space and links it to the event', async ({ page }, {
		retry
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'New Event' }).click();

		const title = `${SEED_EVENT_TITLE_PREFIX} ${Date.now()}`;
		await page.locator('input[name="title"]').fill(title);
		await page.locator('input[name="eventDate"]').fill(bookingDate(EVENT_DATE, retry));
		await page.locator('input[name="eventStartTime"]').fill(EVENT_START);
		await page.locator('input[name="eventEndTime"]').fill(EVENT_END);
		await page.locator(RESERVE_TOGGLE).check();

		await page.getByRole('button', { name: 'Create Event' }).click();

		// handleSuccess navigates to the new event's detail page.
		await waitForEventPage(page, title);

		// The card only renders off `event.reservationId`, so its presence proves
		// the reservation was created AND linked. Matched by role, not text: the
		// staff sidebar's Space group reads "Space / Reservations / Equipment" as
		// one node, which a substring match on "Space Reservation" also catches.
		await expect(page.getByRole('heading', { name: 'Space Reservation' })).toBeVisible();
		await expect(page.getByRole('link', { name: /View reservation/ })).toBeVisible();
	});

	test('re-timing the event carries the setup and teardown padding', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'New Event' }).click();

		await page.locator('input[name="eventStartTime"]').fill('19:00');
		await page.locator('input[name="eventEndTime"]').fill('22:00');
		await page.locator(RESERVE_TOGGLE).check();

		// An hour either side of the show for load-in and load-out.
		await page.locator('input[name="reservationStartTime"]').fill('18:00');
		await page.locator('input[name="reservationEndTime"]').fill('23:00');
		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue('18:00');

		// The show moves two hours earlier.
		await page.locator('input[name="eventStartTime"]').fill('17:00');
		await page.locator('input[name="eventEndTime"]').fill('20:00');

		// Seeding only-while-empty left the hold at 18:00–23:00, booking a window
		// that no longer wrapped the show. Re-seeding from the event outright would
		// give 17:00–20:00 and throw the padding away. The padding moves with it.
		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue('16:00');
		await expect(page.locator('input[name="reservationEndTime"]')).toHaveValue('21:00');
	});

	test('the reservation list links an event hold to its event, not to the booker', async ({
		page
	}, { retry }) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'New Event' }).click();

		const eventDate = bookingDate(SEED_LIST_LINK_DATE, retry);
		const title = `${SEED_EVENT_TITLE_PREFIX} ${Date.now()}`;
		await page.locator('input[name="title"]').fill(title);
		await page.locator('input[name="eventDate"]').fill(eventDate);
		await page.locator('input[name="eventStartTime"]').fill(EVENT_START);
		await page.locator('input[name="eventEndTime"]').fill(EVENT_END);
		await page.locator(RESERVE_TOGGLE).check();
		await page.getByRole('button', { name: 'Create Event' }).click();

		await waitForEventPage(page, title);
		const eventId = new URL(page.url()).pathname.split('/').pop()!;

		await page.goto('/staff/reservations');
		// Searching the title is itself part of the change: the list only matched
		// member and band names, so an event hold was unfindable by its show.
		await page.getByPlaceholder('Search member, band, or event...').fill(title);
		// The date bounds keep the row off a later page of the 50-row list.
		await page.getByLabel('From date').fill(eventDate);
		await page.getByLabel('To date').fill(eventDate);

		const row = page.locator('tr', { has: page.getByRole('link', { name: title }) });
		await expect(row.getByRole('link', { name: title })).toHaveAttribute(
			'href',
			`/staff/events/${eventId}`
		);
		// The staff account that raised the hold is not what the row is about.
		await expect(row.locator('a[href^="/staff/users/"]')).toHaveCount(0);

		// The detail page leads with the show too — its card used to be a bare
		// "Member", with the event nowhere on the page.
		await row.locator('a[href^="/staff/reservations/"]').first().click();
		await page.waitForURL(/\/staff\/reservations\/[^/]+$/, { timeout: 15000 });
		await expect(page.getByRole('link', { name: 'View Event' })).toHaveAttribute(
			'href',
			`/staff/events/${eventId}`
		);
		await expect(page.getByText('Booked by')).toBeVisible();
	});

	test('unchecking the toggle drops the conflict override it raised', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'New Event' }).click();

		await page.locator('input[name="title"]').fill('E2E Conflict Probe');
		await page.locator('input[name="eventDate"]').fill(SEED_CONFLICT_DATE);
		await page.locator('input[name="eventStartTime"]').fill(SEED_CONFLICT_START);
		await page.locator('input[name="eventEndTime"]').fill(SEED_CONFLICT_END);
		await page.locator(RESERVE_TOGGLE).check();

		// The seeded booking holds this window, so the warning has to fire.
		await expect(page.getByText(/Conflicts with reservation/)).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole('button', { name: 'Create with Override' })).toBeVisible();

		// ConflictWarnings unmounts with the toggle and stops maintaining the flag.
		// Left stale, it keeps the hidden overrideConflicts input in the form and
		// the next submission skips the server's double-booking check.
		await page.locator(RESERVE_TOGGLE).uncheck();

		await expect(page.getByRole('button', { name: 'Create Event' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create with Override' })).toHaveCount(0);
	});
});

/**
 * The other half of the same defect. #206 repaired creation, but an event that
 * was created without a hold had no way to acquire one: update() ignored the
 * reservation params unless the event already had a reservationId, and the edit
 * form only offered reservation fields when a *rebook* was needed. Production
 * reached 18 events with zero reservations and nothing could repair any of them.
 */
test.describe('staff event edit — reserve space', () => {
	const RESERVE_CHECKBOX = { name: 'Reserve practice space' };

	test('an event created without space can book it from the edit form', async ({ page }, {
		retry
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'New Event' }).click();

		const title = `${SEED_EVENT_TITLE_PREFIX} edit ${Date.now()}`;
		await page.locator('input[name="title"]').fill(title);
		await page.locator('input[name="eventDate"]').fill(bookingDate(SEED_EDIT_EVENT_DATE, retry));
		await page.locator('input[name="eventStartTime"]').fill(EVENT_START);
		await page.locator('input[name="eventEndTime"]').fill(EVENT_END);
		// Deliberately left unchecked — this is the state prod is full of.
		await page.getByRole('button', { name: 'Create Event' }).click();

		await waitForEventPage(page, title);

		// The card always renders now; with no hold it says so, rather than
		// vanishing and leaving "not held" indistinguishable from "not shown".
		await expect(page.getByText('No space held for this event')).toBeVisible();

		await page.getByRole('button', { name: 'Edit' }).click();
		const reserve = page.getByRole('checkbox', RESERVE_CHECKBOX);
		await expect(reserve).toBeVisible();
		await reserve.check();

		// Pre-filled from the event's own window: the times are a setup/teardown
		// override, not a precondition.
		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue(EVENT_START);
		await expect(page.locator('input[name="reservationEndTime"]')).toHaveValue(EVENT_END);

		await page.getByRole('button', { name: 'Save' }).click();

		// Presence of the link proves the reservation was created AND linked.
		await expect(page.getByRole('link', { name: /View reservation/ })).toBeVisible({
			timeout: 15000
		});
	});

	test('re-timing an event does not report its own hold as a conflict', async ({ page }, {
		retry
	}) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'New Event' }).click();

		const title = `${SEED_EVENT_TITLE_PREFIX} self ${Date.now()}`;
		await page.locator('input[name="title"]').fill(title);
		await page.locator('input[name="eventDate"]').fill(bookingDate(SEED_SELF_CONFLICT_DATE, retry));
		await page.locator('input[name="eventStartTime"]').fill(EVENT_START);
		await page.locator('input[name="eventEndTime"]').fill(EVENT_END);
		await page.locator(RESERVE_TOGGLE).check();
		await page.getByRole('button', { name: 'Create Event' }).click();

		await waitForEventPage(page, title);
		await expect(page.getByRole('link', { name: /View reservation/ })).toBeVisible();

		// Start the show two hours earlier. That escapes the current hold, so the
		// edit form raises the rebook alert and mounts ConflictWarnings against a
		// window that overlaps the event's own reservation. Earlier rather than
		// later on purpose: 17:00–22:00 stays inside the 09:00–22:00 operating
		// hours, so no out-of-hours warning muddies the picture.
		await page.getByRole('button', { name: 'Edit' }).click();
		await page.locator('input[name="eventStartTime"]').fill('17:00');
		await page.getByRole('checkbox', { name: 'Confirm rebook' }).check();

		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue('17:00');

		// The seeded dates are years out, so ConflictWarnings always reports the
		// advance-booking warning here. Asserting it first proves the component
		// actually ran and rendered — without it, the check below would pass just
		// as happily against a panel that never mounted.
		await expect(page.getByText('More than 14 days in advance')).toBeVisible();

		// The real assertion. checkConflicts filtered on `!('id' in c)` while
		// getConflictDetails never selected an id, so the filter dropped nothing and
		// the event's own hold came back as a conflict against a window that merely
		// extends it. Note this is about the *reservation* warning specifically —
		// "Override conflicts" is still offered here, for the advance-days warning.
		await expect(page.getByText(/Conflicts with reservation/)).toHaveCount(0);
	});
});
