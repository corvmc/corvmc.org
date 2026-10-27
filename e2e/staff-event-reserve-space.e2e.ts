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
 * End-to-end pin for "Reserve practice space", which lives on the listing's
 * edit form at `/staff/events/[id]` (#1946). The create modal asks only for what the row needs
 * (#1822's rule), so every hold below is raised after the event exists.
 *
 * The toggle once passed its value one-way to FormField, so the reservation
 * times never mounted and the event saved with no hold and no error. Only an
 * e2e catches that class: the server specs post the fields the browser failed
 * to render.
 */

async function loginAsStaff(page: Page) {
	await page.goto('/login');
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

/**
 * Creating a show lands on the listing with `?edit=1`, its edit form already
 * open. Reloaded without the query so every test opens Edit itself, from the
 * same closed state.
 */
async function goToListing(page: Page, title: string) {
	await waitForEventPage(page, title);
	await page.goto(new URL(page.url()).pathname);
	await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15000 });
}

const RESERVE_CHECKBOX = { name: 'Reserve practice space' };

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

/** Create an event through the minimal modal and land on its listing. */
async function createEvent(
	page: Page,
	title: string,
	date: string,
	start = EVENT_START,
	end = EVENT_END
) {
	await page.goto('/staff/events');
	await page.getByRole('button', { name: 'Create Listing' }).click();
	await page.locator('input[name="title"]').fill(title);
	await page.locator('input[name="eventDate"]').fill(date);
	await page.locator('input[name="eventStartTime"]').fill(start);
	await page.locator('input[name="eventEndTime"]').fill(end);
	await page.getByRole('dialog').getByRole('button', { name: 'Create Listing' }).click();
	await goToListing(page, title);
}

/** From the listing: open Edit, tick the hold, save, and wait for the link. */
async function holdSpace(page: Page) {
	await page.getByRole('button', { name: 'Edit' }).click();
	await page.getByRole('checkbox', RESERVE_CHECKBOX).check();
	// `exact`: the open edit form also carries "Save bill".
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('a[href^="/staff/reservations/"]').first()).toBeVisible({
		timeout: 15000
	});
}

test.describe('staff event creation — minimal modal', () => {
	test('the create modal asks for no room, ticket or poster', async ({ page }) => {
		await loginAsStaff(page);
		await page.goto('/staff/events');
		await page.getByRole('button', { name: 'Create Listing' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog.locator('input[name="title"]')).toBeVisible({ timeout: 15000 });
		await expect(dialog.locator('input[name="eventEndTime"]')).toBeVisible();
		await expect(dialog.getByText('Reserve practice space')).toHaveCount(0);
		await expect(dialog.getByText('Sell tickets through the site')).toHaveCount(0);
		await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
	});

	test('re-timing the event carries the setup and teardown padding', async ({ page }) => {
		await loginAsStaff(page);
		// Never saved, so the date cannot collide with anything.
		await createEvent(page, `${SEED_EVENT_TITLE_PREFIX} pad ${Date.now()}`, EVENT_DATE);

		await page.getByRole('button', { name: 'Edit' }).click();
		await page.getByRole('checkbox', RESERVE_CHECKBOX).check();
		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue(EVENT_START);
		await expect(page.locator('input[name="reservationEndTime"]')).toHaveValue(EVENT_END);

		// An hour either side of the 19:00–22:00 show for load-in and load-out.
		await page.locator('input[name="reservationStartTime"]').fill('18:00');
		await page.locator('input[name="reservationEndTime"]').fill('23:00');

		// The show moves two hours earlier, and the padding moves with it.
		await page.locator('input[name="eventStartTime"]').fill('17:00');
		await page.locator('input[name="eventEndTime"]').fill('20:00');
		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue('16:00');
		await expect(page.locator('input[name="reservationEndTime"]')).toHaveValue('21:00');
	});

	test('the reservation list links an event hold to its event, not to the booker', async ({
		page
	}, { retry }) => {
		await loginAsStaff(page);
		const eventDate = bookingDate(SEED_LIST_LINK_DATE, retry);
		const title = `${SEED_EVENT_TITLE_PREFIX} ${Date.now()}`;
		await createEvent(page, title, eventDate);
		const eventId = new URL(page.url()).pathname.split('/').at(-1)!;
		await holdSpace(page);

		await page.goto('/staff/reservations');
		// Searching the title is itself part of the change: the list only matched
		// member and band names, so an event hold was unfindable by its show.
		await page.getByRole('searchbox').fill(title);
		// The date bounds keep the row off a later page of the 50-row list. They
		// sit in the Filters menu, closed again so it cannot cover the row.
		await page.getByRole('button', { name: /^Filters/ }).click();
		await page.getByLabel('From date').fill(eventDate);
		await page.getByLabel('To date').fill(eventDate);
		await page.keyboard.press('Escape');
		await expect(page.getByLabel('From date')).toBeHidden();

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

	test('a double-booking blocks the save until the override is ticked', async ({ page }) => {
		await loginAsStaff(page);
		await createEvent(
			page,
			`${SEED_EVENT_TITLE_PREFIX} conflict ${Date.now()}`,
			SEED_CONFLICT_DATE,
			SEED_CONFLICT_START,
			SEED_CONFLICT_END
		);
		await page.getByRole('button', { name: 'Edit' }).click();
		const reserve = page.getByRole('checkbox', RESERVE_CHECKBOX);
		await reserve.check();

		// The seeded booking holds this window, so the overlap has to fire — and it
		// is an error, not a warning.
		await expect(page.getByText(/Double-books the space/)).toBeVisible({ timeout: 15000 });

		const override = page.getByRole('checkbox', { name: /double-books the space/i });
		const submit = page.getByRole('button', { name: 'Save', exact: true });

		// A second, deliberate action rather than a relabelled submit.
		await expect(override).not.toBeChecked();
		await expect(submit).toBeDisabled();
		await override.check();
		await expect(submit).toBeEnabled();

		// Unticking the hold clears the flag, so a stale override cannot ride
		// along on the next save and skip the server's double-booking check.
		await reserve.uncheck();
		await expect(submit).toBeEnabled();
		await expect(page.getByRole('checkbox', { name: /double-books the space/i })).toHaveCount(0);
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
	test('an event created without space can book it from the edit form', async ({ page }, {
		retry
	}) => {
		await loginAsStaff(page);
		const title = `${SEED_EVENT_TITLE_PREFIX} edit ${Date.now()}`;
		await createEvent(page, title, bookingDate(SEED_EDIT_EVENT_DATE, retry));

		// The card always renders now; with no hold it says so, rather than
		// vanishing and leaving "not held" indistinguishable from "not shown".
		await expect(page.getByRole('heading', { name: 'Space Reservation' })).toBeVisible();

		await page.getByRole('button', { name: 'Edit' }).click();
		const reserve = page.getByRole('checkbox', RESERVE_CHECKBOX);
		await expect(reserve).toBeVisible();
		await reserve.check();

		// Pre-filled from the event's own window: the times are a setup/teardown
		// override, not a precondition.
		await expect(page.locator('input[name="reservationStartTime"]')).toHaveValue(EVENT_START);
		await expect(page.locator('input[name="reservationEndTime"]')).toHaveValue(EVENT_END);

		// `exact`: the open edit form also carries "Save bill", and a substring
		// match resolves to both the moment the lineup editor renders.
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		// Presence of the link proves the reservation was created AND linked. By
		// href, not by wording: the card is an EntityIdentity now.
		await expect(page.locator('a[href^="/staff/reservations/"]').first()).toBeVisible({
			timeout: 15000
		});
	});

	test('re-timing an event does not report its own hold as a conflict', async ({ page }, {
		retry
	}) => {
		await loginAsStaff(page);
		const title = `${SEED_EVENT_TITLE_PREFIX} self ${Date.now()}`;
		await createEvent(page, title, bookingDate(SEED_SELF_CONFLICT_DATE, retry));
		await holdSpace(page);

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
		// extends it.
		await expect(page.getByText(/Double-books the space/)).toHaveCount(0);

		// And the advance-days warning on its own asks for nothing. It used to
		// offer an override, which is how "this is further out than we normally
		// take" ended up wearing the same control as "somebody else has the room".
		await expect(page.getByRole('checkbox', { name: /double-books the space/i })).toHaveCount(0);
	});
});
