import { test, expect, type Page } from '@playwright/test';
import { expectSuccessToast } from './toast';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';
import {
	SEED_VOL_MEMBER_EMAIL,
	SEED_VOL_MEMBER_PASSWORD,
	SEED_VOL_MEMBER_NAME,
	SEED_VOL_ROLE_NAME,
	SEED_VOL_ARCHIVED_ROLE_NAME,
	SEED_VOL_ROLE_BOLD_PHRASE,
	SEED_VOL_LOG_APPROVE_DESC,
	SEED_VOL_LOG_REJECT_DESC,
	SEED_VOL_LOG_REJECTED_DESC,
	SEED_VOL_REJECTED_REASON,
	SEED_VOL_CERT_NAME,
	SEED_VOL_GATED_ROLE_NAME,
	SEED_VOL_ROLE_DEFAULT_CAPACITY,
	SEED_VOL_GATED_DEFAULT_CAPACITY,
	SEED_VOL_SHIFT_OPEN_ID,
	SEED_VOL_SHIFT_ASSIGN_ID,
	SEED_VOL_SHIFT_RELEASE_ID,
	SEED_VOL_OTHER_MEMBER_ID,
	SEED_VOL_MEMBER_ID,
	SEED_VOL_SHIFT_EVENT_ID,
	SEED_VOL_EVENT_ID,
	SEED_VOL_EVENT_TITLE,
	SEED_VOL_SIGNUP_DONE_ID,
	SEED_VOL_NEW_MEMBER_EMAIL,
	SEED_VOL_NEW_MEMBER_ID,
	SEED_VOL_NEW_MEMBER_NAME,
	SEED_VOL_MINOR_EMAIL,
	SEED_VOL_MINOR_FIRST,
	SEED_VOL_MINOR_LAST,
	SEED_VOL_BLOCKED_MINOR_EMAIL,
	SEED_VOL_BLOCKED_MINOR_NAME,
	SEED_VOL_BLOCKED_MINOR_FIRST,
	SEED_VOL_BLOCKED_MINOR_LAST,
	readVolunteerState,
	readSignupStatus,
	readShiftSignups,
	readNewestHourLog,
	readShiftEventId
} from './fixtures/seed-volunteering';

/**
 * End-to-end coverage for the volunteering module (Phase 1).
 *
 * These pin the three things the service unit tests structurally cannot reach,
 * each of which shipped broken during development and was caught only by
 * clicking the page:
 *
 *  1. A review must remove the row from the Pending table. SvelteKit's
 *     `refresh()` is keyed by argument, so refreshing `getStaffVolunteerLogs({})`
 *     from the remote function updated the argless tab counts while the
 *     arg-keyed table kept rendering the row that had just been approved.
 *  2. A rejection with no reason must show written copy. The zod `.min(1)` fired
 *     before the service's own message and rendered "Too small: expected string
 *     to have >=1 characters" at staff.
 *  3. Approving must not mint practice credits. The unit suite asserts the
 *     credit service is never called; this asserts no row actually lands.
 */

/**
 * Read-backs go through `readLocalDb`, which opens the run's SQLite file
 * directly while the preview server is still writing through workerd. A row the
 * page has already stopped rendering is therefore not yet guaranteed to be
 * visible to a fresh reader — the gap is normal, not a symptom — so every
 * assertion against the database polls rather than reading once. A one-shot
 * read here is the bug that failed this spec on CI and nowhere else.
 */
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

/** Fill the onboarding form. `age` picks the 18-or-older answer. */
async function fillOnboarding(
	page: Page,
	{ first, last, age }: { first: string; last: string; age: 'yes' | 'no' }
) {
	await page.locator('input[name="firstName"]').fill(first);
	await page.locator('input[name="lastName"]').fill(last);
	// Required at sign-up, optional on the edit form: shift-day contact is the
	// reason the field exists, so signing up without one leaves a coordinator
	// with no way to reach somebody who is on tonight.
	await page.locator('input[name="phone"]').fill('(541) 555-0100');
	// A select, not a checkbox — an unticked box would be indistinguishable from
	// an unanswered question, which is the one mistake this field cannot make.
	await page.locator('select[name="isAdult"]').selectOption(age);
	await page.getByRole('button', { name: 'Continue' }).click();
}

/** The row's action buttons are icon-only; scope by the row's description text. */
function rowFor(page: Page, description: string) {
	return page.locator('tr').filter({ hasText: description });
}

/**
 * An icon-only `Action` renders its real button inside a bits-ui tooltip
 * trigger, which is itself a `<button>` — so `getByRole('button', { name })`
 * matches two elements and trips strict mode. Target the inner one by its
 * `data-button-root` marker. (The nested-button pair is a real a11y defect in
 * the shared Button component, tracked separately; these selectors work either
 * way once it is fixed.)
 */
function rowAction(row: ReturnType<typeof rowFor>, name: string) {
	return row.locator(`button[data-button-root][aria-label="${name}"]`);
}

/** The modal's submit button, scoped so row actions of the same name can't match. */
function modalSubmit(page: Page, name: string) {
	return page.getByRole('dialog').getByRole('button', { name, exact: true });
}

test.describe('volunteering — staff review queue', () => {
	test('approving a log removes it from Pending and moves the counts', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		// The queue moved off the section root when that became the coordinator's
		// dashboard. Everything it asserts is unchanged; only the address is.
		await page.goto('/staff/volunteer/hours');

		const row = rowFor(page, SEED_VOL_LOG_APPROVE_DESC);
		await expect(row).toBeVisible();

		await rowAction(row, 'Approve').click();
		await modalSubmit(page, 'Approve').click();

		// The regression: the row has to leave the table, not just the counts.
		await expect(row).toHaveCount(0, { timeout: 15000 });

		// Polled, not read once. The row leaving the table proves the page is
		// right; it says nothing about when a reader opening the SQLite file
		// itself sees the write. Attempt 0 of run 33136967674 read `pending` here
		// with the row already gone — the UI was correct and the read was early.
		await expect
			.poll(async () => (await readVolunteerState()).approveLogStatus, DB_POLL)
			.toBe('approved');
		// Volunteer hours are a record, not a currency. Asserted in the same test
		// as the approval rather than its own: the fixture seeds one approvable
		// log and the suite shares a database, so a second test approving "the
		// same" row finds it already gone.
		//
		// One-shot is safe: the poll above has already established that this
		// review is visible to this reader, and a credit row would have been
		// written by the same request.
		expect((await readVolunteerState()).creditRowCount).toBe(0);
	});

	test('rejecting without a reason shows written copy, not raw zod text', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/hours');

		const row = rowFor(page, SEED_VOL_LOG_REJECT_DESC);
		await rowAction(row, 'Return').click();
		await modalSubmit(page, 'Return').click();

		await expect(page.getByText(/reason/i).first()).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(/expected string to have/i)).toHaveCount(0);
	});

	test('a rejection records its reason and leaves the pending queue', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/hours');

		const reason = 'E2E: hours look doubled for this shift.';
		const row = rowFor(page, SEED_VOL_LOG_REJECT_DESC);
		await rowAction(row, 'Return').click();
		await page.locator('textarea[name="notes"]').fill(reason);
		await modalSubmit(page, 'Return').click();
		await expect(row).toHaveCount(0, { timeout: 15000 });

		// Kept staff-side deliberately: signing a second user in over an existing
		// session in the same browser context does not swap the session, so the
		// member view is asserted separately from its own login.
		await page.getByRole('tab', { name: /Returned/ }).click();
		const rejected = rowFor(page, SEED_VOL_LOG_REJECT_DESC);
		await expect(rejected).toBeVisible({ timeout: 15000 });
		await expect(rejected).toContainText(reason);
	});
});

test.describe('volunteering — roles', () => {
	/** Setup is navigation; role actions live on the detail page. */
	async function openRole(page: Page, name: string) {
		await page.getByRole('link', { name, exact: false }).first().click();
		await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
	}

	/** A role on Setup is a card, not a table row. */
	function cardFor(page: Page, name: string) {
		return page.locator('li').filter({ hasText: name });
	}

	test('a role with logged hours cannot be deleted, and says to archive instead', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/setup');
		await openRole(page, SEED_VOL_ROLE_NAME);

		// Delete is offered only for a role nothing was logged against, so the
		// guard is that the control is absent for one that has history.
		await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
	});

	test('an archived role stays visible to staff, behind the retired filter', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/setup');

		// Retired roles are off by default — a coordinator filling next week's
		// shifts reads the live list.
		await expect(cardFor(page, SEED_VOL_ARCHIVED_ROLE_NAME)).toHaveCount(0);

		await page.goto('/staff/volunteer/setup?retired=1');

		// But retiring a role must never hide the work done under it.
		await expect(cardFor(page, SEED_VOL_ARCHIVED_ROLE_NAME).first()).toBeVisible();
		await openRole(page, SEED_VOL_ARCHIVED_ROLE_NAME);
		await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
	});

	test('the role detail lists who is interested, and whether they are cleared', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/setup');

		// Ungated role: the member is simply on the list.
		await openRole(page, SEED_VOL_ROLE_NAME);
		await expect(page.getByText(SEED_VOL_MEMBER_NAME).first()).toBeVisible({ timeout: 15000 });

		// Gated role: same member, but holding none of what it requires — the
		// difference between "interested" and "can actually be rostered".
		await page.goto('/staff/volunteer/setup');
		await openRole(page, SEED_VOL_GATED_ROLE_NAME);
		await expect(page.getByText(SEED_VOL_MEMBER_NAME).first()).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(`needs ${SEED_VOL_CERT_NAME}`)).toBeVisible();
		// "cleared today", not "ready". This page has no one shift in mind, so the gate can
		// only be evaluated against now — while the gate that actually refuses a claim is
		// evaluated as of the shift's date, and a card expiring next week does not cover a
		// shift the week after (docs/reports/volunteer-workflow-findings.md#a7). The
		// shift-scoped version of this count lives on AddVolunteerAction, which passes one.
		await expect(page.getByText('0 of 1 cleared today')).toBeVisible();
	});

	test('roles are sectioned by group, with a short-staffed count', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/setup');

		// Group order comes from the enum, so "At shows" leads. It is a label
		// rather than a heading on purpose — `getByRole('heading')` is how pages
		// assert their own title, and a screen full of headings collides with that.
		await expect(page.getByText('At shows', { exact: true })).toBeVisible();
		await expect(cardFor(page, SEED_VOL_ROLE_NAME).first()).toBeVisible();

		// The open seeded shift is unclaimed, so its role reads as short. Which
		// role keeps coming up short is what tells you to go and recruit for it.
		const gatedCard = cardFor(page, SEED_VOL_GATED_ROLE_NAME).first();
		await expect(gatedCard).toBeVisible();
		await expect(gatedCard.locator('.badge-warning')).toBeVisible();
	});

	test('editing a role from its detail page saves', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/setup');
		await openRole(page, SEED_VOL_ROLE_NAME);

		// The edit form moved off the list into this page, so the round trip is
		// worth asserting rather than assuming.
		const order = page.locator('input[name$="displayOrder"]');
		await order.fill('4');
		await page.getByRole('button', { name: /Save/ }).click();
		await expectSuccessToast(page, 15000);

		await page.reload();
		await expect(page.locator('input[name$="displayOrder"]')).toHaveValue('4');

		// The shift defaults must survive an edit that never touched them.
		await expect(page.locator('input[name$="defaultCapacity"]')).toHaveValue(
			String(SEED_VOL_ROLE_DEFAULT_CAPACITY)
		);
	});

	// Blank means "no default", which is a different answer from zero and has to
	// survive the round trip as such.
	test('a shift default can be cleared', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/setup');
		await openRole(page, SEED_VOL_ROLE_NAME);

		await page.locator('input[name$="defaultCapacity"]').fill('');
		await page.getByRole('button', { name: /Save/ }).click();
		await expectSuccessToast(page, 15000);

		await page.reload();
		await expect(page.locator('input[name$="defaultCapacity"]')).toHaveValue('');

		// And the New Shift form falls back rather than carrying a stale number.
		await page.getByRole('button', { name: 'New shift' }).click();
		await expect(page.getByRole('dialog').locator('input[name="capacity"]')).toHaveValue('1');
		await page.keyboard.press('Escape');

		// Put it back: the fixture seeds once per run, and the prefill tests below
		// read this same role.
		await page
			.locator('input[name$="defaultCapacity"]')
			.fill(String(SEED_VOL_ROLE_DEFAULT_CAPACITY));
		await page.getByRole('button', { name: /Save/ }).click();
		await expectSuccessToast(page, 15000);
	});

	// The columns were dead in the schema before this — nothing read or wrote
	// them — so the whole path from role row to prefilled form is new.
	test("a role's shift defaults prefill the New Shift form", async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/setup');
		await openRole(page, SEED_VOL_ROLE_NAME);

		await page.getByRole('button', { name: 'New shift' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.locator('input[name="capacity"]')).toHaveValue(
			String(SEED_VOL_ROLE_DEFAULT_CAPACITY)
		);
	});

	// On the schedule the role is chosen inside the modal, so the prefill has to
	// follow the select. The select is bound, which is also how it could break:
	// a bound value matching no option posts an empty role.
	test('the schedule prefill follows the role picked in the modal', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/schedule');

		await page.getByRole('button', { name: 'New Shift' }).click();
		const dialog = page.getByRole('dialog');
		const roleSelect = dialog.locator('select[name="volunteerRoleId"]');

		// Never left on nothing — that is the failure mode this guards.
		await expect(roleSelect).not.toHaveValue('');

		await roleSelect.selectOption({ label: SEED_VOL_ROLE_NAME });
		await expect(dialog.locator('input[name="capacity"]')).toHaveValue(
			String(SEED_VOL_ROLE_DEFAULT_CAPACITY)
		);

		await roleSelect.selectOption({ label: SEED_VOL_GATED_ROLE_NAME });
		await expect(dialog.locator('input[name="capacity"]')).toHaveValue(
			String(SEED_VOL_GATED_DEFAULT_CAPACITY)
		);
	});

	test('the retired interest route redirects onto the volunteers index', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/interest');

		await expect(page).toHaveURL(/\/staff\/volunteer\/people$/);
	});

	test('the retired shift catalog redirects onto the schedule', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/shifts');

		await expect(page).toHaveURL(/\/staff\/volunteer\/schedule$/);
	});

	/**
	 * The index is keyed on the volunteer profile, not on interest rows — which is
	 * the whole reason it exists as its own page. The blocked minor never reached
	 * the (skippable) interests step, so an interest-keyed list would drop the one
	 * person on this page who most needs looking at.
	 */
	test('the volunteers index lists somebody who signed up without picking a role', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/people');

		const interested = page.getByRole('row', { name: SEED_VOL_MEMBER_NAME });
		await expect(interested).toBeVisible({ timeout: 15000 });
		await expect(interested.getByText(SEED_VOL_ROLE_NAME)).toBeVisible();

		await expect(page.getByRole('row', { name: SEED_VOL_BLOCKED_MINOR_NAME })).toBeVisible();
	});

	/**
	 * Narrowing by role must not narrow what each surviving row shows: the member
	 * is interested in the gated role too, and that badge is the "what else would
	 * they do" signal the EXISTS filter exists to preserve.
	 */
	test('filtering the volunteers index by role keeps every role on the rows that match', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/people');
		await expect(page.getByRole('row', { name: SEED_VOL_MEMBER_NAME })).toBeVisible({
			timeout: 15000
		});

		await page
			.getByRole('combobox', { name: 'Interested in role' })
			.selectOption({ label: SEED_VOL_ROLE_NAME });

		const row = page.getByRole('row', { name: SEED_VOL_MEMBER_NAME });
		await expect(row).toBeVisible();
		await expect(row.getByText(SEED_VOL_GATED_ROLE_NAME)).toBeVisible();

		// Somebody with no interests at all cannot match a role filter.
		await expect(page.getByRole('row', { name: SEED_VOL_BLOCKED_MINOR_NAME })).toHaveCount(0);

		// The filter survives a reload, which is what the URL mirroring is for.
		await expect(page).toHaveURL(/role=/);
		await page.reload();
		await expect(page.getByRole('row', { name: SEED_VOL_MEMBER_NAME })).toBeVisible({
			timeout: 15000
		});
	});

	test('the report counts hours logged under a since-archived role', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/report');

		await expect(page.getByText(SEED_VOL_ARCHIVED_ROLE_NAME)).toBeVisible({ timeout: 15000 });
	});
});

test.describe('volunteering — member', () => {
	test('the interests screen renders a role job description as markdown', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		// Its own screen rather than a modal over the board: it is the same length
		// as the board it filters, and a dialog that tall is a page in a costume.
		await page.goto('/member/volunteer/interests');

		const modal = page.locator('main');
		await expect(modal).toBeVisible({ timeout: 15000 });

		await expect(modal.getByText(SEED_VOL_ROLE_NAME).first()).toBeVisible();
		// The seeded description bolds this phrase; rendered markdown means a
		// <strong>, not literal asterisks. This was shipped broken — the page ran
		// the markdown through `sanitizeBio`, an HTML sanitizer, which left the
		// asterisks on screen.
		await expect(modal.locator('strong', { hasText: SEED_VOL_ROLE_BOLD_PHRASE })).toBeVisible();
		await expect(modal.getByText(`**${SEED_VOL_ROLE_BOLD_PHRASE}**`)).toHaveCount(0);

		// Archiving hides a role from the picker only — the member's own history
		// still names it, so this is scoped to the modal rather than the page.
		await expect(modal.getByText(SEED_VOL_ARCHIVED_ROLE_NAME)).toHaveCount(0);
	});

	test('a returned log shows the member the reason', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		// The history moved off the dashboard: a log filed in March is not a next
		// action, and the one state that is was buried under everything approved.
		await page.goto('/member/volunteer/hours');

		// Without the reason the member cannot correct and resubmit, which is why
		// the service refuses a rejection that has none.
		const row = page.locator('li').filter({ hasText: SEED_VOL_LOG_REJECTED_DESC });
		await expect(row).toBeVisible({ timeout: 15000 });
		await expect(row).toContainText(SEED_VOL_REJECTED_REASON);
		// "Returned", never "rejected" — a request for a correction, not a verdict.
		await expect(row.getByRole('button', { name: 'Fix it' })).toBeVisible();
	});

	test('a member can log hours and they land as pending', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer/hours');

		const description = `E2E logged ${Date.now()}`;
		await page.getByRole('button', { name: 'Log Hours' }).click();

		await page
			.locator('select[name="volunteerRoleId"]')
			.selectOption({ label: SEED_VOL_ROLE_NAME });
		await page.locator('input[name="hours"]').fill('1.5');
		await page.locator('textarea[name="description"]').fill(description);
		await modalSubmit(page, 'File it').click();

		const row = page.locator('li').filter({ hasText: description });
		await expect(row).toBeVisible({ timeout: 15000 });
		await expect(row).toContainText('1.5 hrs');
		// Editable only while pending — the controls are the proof of status.
		await expect(row.getByRole('button', { name: 'Withdraw' })).toBeVisible();
	});
});

/**
 * Phase 2 — shifts.
 *
 * These exist because the pane-based manual pass could not reach them: the
 * Browser pane drops its auth cookie, and a cached SSR page hides that as a 401
 * on the next POST rather than a visible logout. Everything below is a real
 * client-server round trip through a real session.
 *
 * The shift board lives on `/member/volunteer` above the interest form.
 */
function shiftCard(page: Page, text: string) {
	return page.locator('li').filter({ hasText: text });
}

/**
 * A card on the claim board.
 *
 * The board card no longer carries the shift's briefing — that moved into the
 * claim modal, where the decision actually gets made — so the two seeded
 * Front Desk shifts can only be told apart by the state they are in. Which is
 * also the thing each test is about.
 */
function boardCard(page: Page, role: string, state: string) {
	return page.locator('li').filter({ hasText: role }).filter({ hasText: state });
}

test.describe('volunteering — onboarding', () => {
	/**
	 * The gate. Before this, anybody could walk onto the shift board without the
	 * app knowing their name or, more to the point, their age.
	 */
	test('a member who has not signed up is sent to the start step', async ({ page }) => {
		await login(page, SEED_VOL_NEW_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		await page.waitForURL(/\/member\/volunteer\/start/, { timeout: 15000 });
		await expect(page.getByRole('heading', { name: 'Volunteer with CMC' })).toBeVisible();
	});

	test('the adult path runs start → interests → the shift board', async ({ page }) => {
		await login(page, SEED_VOL_NEW_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer/start');

		await fillOnboarding(page, { first: 'Alex', last: 'Whitfield', age: 'yes' });

		await page.waitForURL(/\/member\/volunteer\/interests/, { timeout: 15000 });

		// Tick a role and leave a note, so the round trip through the JSON-free
		// checkbox array and the profile's availability column is exercised.
		await page.getByRole('checkbox', { name: SEED_VOL_ROLE_NAME }).check();
		await page.locator('textarea[name="availability"]').fill('E2E weekday evenings');
		await page.getByRole('button', { name: 'Finish' }).click();

		await page.waitForURL(/\/member\/volunteer(\?|$)/, { timeout: 15000 });

		// The body is shifts now — the picker must not be sitting open in it.
		await expect(page.getByRole('heading', { name: /open shifts/i })).toBeVisible();

		// Reopening shows the selection survived the replace-all write. Interests is
		// a screen now rather than a modal over the board: it is the same length as
		// the board it filters, and a dialog that tall is a page in a costume.
		// `exact` matters: the summary row's "Interests →" link points at the same
		// page, and a substring match resolves to both.
		await page.getByRole('link', { name: 'Interests', exact: true }).click();
		await page.waitForURL(/\/member\/volunteer\/interests/, { timeout: 15000 });
		await expect(page.getByRole('checkbox', { name: SEED_VOL_ROLE_NAME })).toBeChecked();
		await expect(page.locator('textarea[name="availability"]')).toHaveValue('E2E weekday evenings');
	});

	/**
	 * The whole reason the table exists. Answering "under 18" must be terminal
	 * until a person intervenes — and must stay terminal across a reload, since
	 * the gate is a redirect and not a one-shot flash.
	 */
	test('answering under 18 blocks self-signup and survives a reload', async ({ page }) => {
		await login(page, SEED_VOL_MINOR_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer/start');

		await fillOnboarding(page, {
			first: SEED_VOL_MINOR_FIRST,
			last: SEED_VOL_MINOR_LAST,
			age: 'no'
		});

		await page.waitForURL(/\/member\/volunteer\/blocked/, { timeout: 15000 });
		await expect(page.getByText(/under 18/i)).toBeVisible();

		// No way back in by hand.
		await page.goto('/member/volunteer');
		await page.waitForURL(/\/member\/volunteer\/blocked/, { timeout: 15000 });
	});

	/**
	 * Uses its own already-blocked member rather than the one the test above
	 * creates: the fixture runs once for the whole file, so chaining these would
	 * break the moment either is run alone or retried.
	 */
	test('staff can approve a blocked minor, and then they get in', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer');

		const row = rowFor(page, `${SEED_VOL_BLOCKED_MINOR_FIRST} ${SEED_VOL_BLOCKED_MINOR_LAST}`);
		await expect(row).toBeVisible({ timeout: 15000 });
		await row.getByRole('button', { name: 'Approve' }).click();
		await modalSubmit(page, 'Approve').click();

		// The queue is the blocked list, so approving empties the row out of it.
		await expect(row).toHaveCount(0, { timeout: 15000 });

		// Signing a second user in over an existing session does not swap it — the
		// staff session would survive, and staff have no volunteer profile, so the
		// assertion below would land on /start instead of the board.
		await page.context().clearCookies();
		await login(page, SEED_VOL_BLOCKED_MINOR_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');
		await expect(page.getByRole('heading', { name: /open shifts/i })).toBeVisible({
			timeout: 15000
		});
	});

	test('the profile modal saves a changed phone back to the account', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		const phone = `(541) 555-${String(Date.now()).slice(-4)}`;
		await page.getByRole('button', { name: 'Profile' }).click();
		const modal = page.getByRole('dialog');
		await expect(modal).toBeVisible({ timeout: 15000 });
		await modal.locator('input[name="phone"]').fill(phone);
		await modalSubmit(page, 'Save').click();
		await expect(modal).toHaveCount(0, { timeout: 15000 });

		// Written to `user`, not duplicated onto the profile — so it shows up on
		// the account page, which is the other editor of the same column.
		await page.goto('/member/account');
		await expect(page.locator('input[name="phone"]')).toHaveValue(phone, { timeout: 15000 });
	});
});

test.describe('volunteering — shifts', () => {
	test('a member can claim an open shift and then drop out', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		const open = boardCard(page, SEED_VOL_ROLE_NAME, "I'll do it");
		await expect(open.first()).toBeVisible({ timeout: 15000 });

		await open.first().getByRole('button', { name: "I'll do it" }).click();
		await modalSubmit(page, "I'll do it").click();

		// A claim crosses the page: the board is what you could take on, and the
		// left column is what you have. Landing on "Claimed" rather than "Booked"
		// is the distinction the rail exists to draw.
		const mine = boardCard(page, SEED_VOL_ROLE_NAME, 'Awaiting staff confirmation');
		await expect(mine.first()).toBeVisible({ timeout: 15000 });
		await expect.poll(() => readSignupStatus(SEED_VOL_SHIFT_OPEN_ID), DB_POLL).toBe('claimed');

		// Dropping out has to free the place, not just hide the button — the
		// capacity count is computed from live signups.
		await mine.first().getByRole('button', { name: 'Drop out' }).click();
		await modalSubmit(page, 'Drop out').click();

		await expect(boardCard(page, SEED_VOL_ROLE_NAME, "I'll do it").first()).toBeVisible({
			timeout: 15000
		});
		await expect.poll(() => readSignupStatus(SEED_VOL_SHIFT_OPEN_ID), DB_POLL).toBe('cancelled');
	});

	test('a shift needing a clearance the member lacks says so instead of offering it', async ({
		page
	}) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		const card = shiftCard(page, SEED_VOL_GATED_ROLE_NAME);
		await expect(card).toBeVisible({ timeout: 15000 });

		// The whole design decision: show it with the reason rather than hide it,
		// because the reason is what tells them what to go and get.
		await expect(card).toContainText(SEED_VOL_CERT_NAME);
		await expect(card.getByRole('button', { name: "I'll do it" })).toHaveCount(0);
	});

	test('a full shift is not claimable', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		const card = boardCard(page, SEED_VOL_ROLE_NAME, 'Full');
		await expect(card.first()).toBeVisible({ timeout: 15000 });
		await expect(card.first().getByRole('button', { name: "I'll do it" })).toHaveCount(0);
	});

	test('staff see the claim and can confirm it', async ({ page }) => {
		// Claim as the member first, so staff have something to confirm. Separate
		// contexts rather than two logins in one: signing a second user in over an
		// existing session does not swap it.
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');
		const card = boardCard(page, SEED_VOL_ROLE_NAME, "I'll do it").first();
		await card.getByRole('button', { name: "I'll do it" }).click();
		await modalSubmit(page, "I'll do it").click();
		await expect(
			boardCard(page, SEED_VOL_ROLE_NAME, 'Awaiting staff confirmation').first()
		).toBeVisible({ timeout: 15000 });

		await page.context().clearCookies();
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/volunteer/shifts/${SEED_VOL_SHIFT_OPEN_ID}`);

		const claimant = page.locator('li').filter({ hasText: SEED_VOL_MEMBER_EMAIL });
		await expect(claimant).toBeVisible({ timeout: 15000 });

		await claimant.locator('button[data-button-root][aria-label="Confirm"]').click();
		await modalSubmit(page, 'Confirm').click();

		await expect(page.locator('li').filter({ hasText: SEED_VOL_MEMBER_EMAIL })).toContainText(
			'confirmed',
			{ timeout: 15000 }
		);
		await expect.poll(() => readSignupStatus(SEED_VOL_SHIFT_OPEN_ID), DB_POLL).toBe('confirmed');
	});
});

/**
 * Attaching a shift to a show.
 *
 * The column, the service and the remote schema all carried `eventId` from the
 * day shifts shipped; nothing in the UI ever set it, so the whole link was
 * unreachable. These cover the three ways in, and the one failure mode that
 * cannot be seen on screen.
 */
// Staffing is production work, so the card is on the console at
// `[id]/production` rather than the general event view every staffer lands on.
test.describe('volunteering — shifts and events', () => {
	test('the event page lists the shifts staffing that show', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		// Staffing is the Advance tab's subject on the tabbed console.
		await page.goto(`/staff/events/${SEED_VOL_EVENT_ID}/production?tab=advance`);

		const card = page.locator('.card').filter({ hasText: 'Volunteer Shifts' });
		await expect(card).toBeVisible({ timeout: 15000 });
		await expect(card).toContainText(SEED_VOL_ROLE_NAME);

		// Straight through to the shift, which is the point of the card.
		await card.getByRole('link', { name: SEED_VOL_ROLE_NAME }).click();
		await expect(page).toHaveURL(new RegExp(`/staff/volunteer/shifts/${SEED_VOL_SHIFT_EVENT_ID}$`));
	});

	test('scheduling from the event page attaches the shift to it', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/events/${SEED_VOL_EVENT_ID}/production?tab=advance`);

		const card = page.locator('.card').filter({ hasText: 'Volunteer Shifts' });
		await expect(card).toBeVisible({ timeout: 15000 });
		await card.getByRole('button', { name: 'Schedule a shift' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		// The event is already known here, so it is locked rather than offered —
		// there is no picker to fill in.
		await expect(dialog.locator('input[role="combobox"]')).toHaveCount(0);
		await dialog.locator('select[name="volunteerRoleId"]').selectOption({
			label: SEED_VOL_ROLE_NAME
		});
		await modalSubmit(page, 'Create').click();

		// Two rows now: the fixture's and the one just made.
		await expect(card.getByRole('link', { name: SEED_VOL_ROLE_NAME })).toHaveCount(2, {
			timeout: 15000
		});
	});

	test('a shift can be attached to an event after the fact, and detached again', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/volunteer/shifts/${SEED_VOL_SHIFT_EVENT_ID}`);

		await expect(page.getByRole('link', { name: SEED_VOL_EVENT_TITLE })).toBeVisible({
			timeout: 15000
		});

		// Detach: clear the picker and save.
		await page.getByRole('button', { name: 'Edit' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: `Clear ${SEED_VOL_EVENT_TITLE}` }).click();
		await modalSubmit(page, 'Save').click();

		await expect(page.getByText('Not tied to an event')).toBeVisible({ timeout: 15000 });
		/**
		 * The assertion the page cannot make. A picker that only emits its hidden
		 * input while something is selected posts *no* `eventId` field at all when
		 * cleared — and an absent field means "untouched", not "cleared". The save
		 * reports success either way; only the row tells you which happened.
		 */
		await expect.poll(() => readShiftEventId(SEED_VOL_SHIFT_EVENT_ID), DB_POLL).toBeNull();

		// And back on again, through the search picker this time.
		await page.getByRole('button', { name: 'Edit' }).click();
		const reopened = page.getByRole('dialog');
		// Typed, not filled. `fill()` sets the value and fires one input event;
		// bits-ui's Combobox opens its listbox off the keystrokes, so a filled
		// field searches into a popover that never appears.
		const search = reopened.locator('input[role="combobox"]');
		await search.click();
		await search.pressSequentially('E2E Sludge');
		await reopened.getByRole('option', { name: SEED_VOL_EVENT_TITLE }).click();
		// SearchSelect swaps the input for a badge the moment the pick commits, so
		// this is how the test knows the choice reached the form. Saving without it
		// posts an empty `eventId`, which reads as "cleared" — the assertion below
		// then fails on a shift that was never re-attached.
		await expect(search).toHaveCount(0, { timeout: 15000 });
		await modalSubmit(page, 'Save').click();

		await expect(page.getByRole('link', { name: SEED_VOL_EVENT_TITLE })).toBeVisible({
			timeout: 15000
		});
		await expect
			.poll(() => readShiftEventId(SEED_VOL_SHIFT_EVENT_ID), DB_POLL)
			.toBe(SEED_VOL_EVENT_ID);
	});
});

test.describe('volunteering — post-shift feedback', () => {
	test('the survey takes two answers once, then reads as already answered', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto(`/member/volunteer/feedback/${SEED_VOL_SIGNUP_DONE_ID}`);

		// Four stars. RatingGroup items are the interactive stars in order.
		await page.locator('[data-rating-group-item]').nth(3).click();
		await page.locator('input[name="b:wasSetUp"]').check();
		await page.locator('textarea[name="comment"]').fill('E2E: more gaff tape by the desk.');
		await page.getByRole('button', { name: 'Send it' }).click();

		// The form is withdrawn once the answer lands — that, not the thank-you
		// wording, is what "takes it once" means.
		await expect(page.getByRole('button', { name: 'Send it' })).toHaveCount(0, {
			timeout: 15000
		});

		// Second visit: the unique signupId row means asked-and-answered, and the
		// form must not be offered again.
		await page.goto(`/member/volunteer/feedback/${SEED_VOL_SIGNUP_DONE_ID}`);
		await expect(page.getByRole('button', { name: 'Send it' })).toHaveCount(0);
	});

	test('staff see the response on the shift and in the per-role rollup', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);

		await page.goto(`/staff/volunteer/shifts/e2e-vol-shift-done`);
		await expect(page.getByText('E2E: more gaff tape by the desk.')).toBeVisible({
			timeout: 15000
		});

		// The rollup is anonymous by design — the response appears under its role
		// with no member name attached.
		await page.goto('/staff/volunteer/report');
		const rollupRow = page.locator('tr').filter({ hasText: SEED_VOL_ROLE_NAME }).last();
		await expect(page.getByRole('heading', { name: 'How shifts are going' })).toBeVisible({
			timeout: 15000
		});
		await expect(rollupRow).toContainText('/ 5');
	});
});

/**
 * The coordinator's half of the roster.
 *
 * All three of these were impossible through the UI before — the services took the user as
 * a parameter and only the remote functions were bound to the session
 * (docs/reports/volunteer-workflow-findings.md#a1, #a2, #b1). Each asserts against the
 * database, because what makes them right is the row that lands, not the toast.
 */
test.describe('volunteering — staff acting on somebody else', () => {
	test('staff can put a member on a shift, and they land confirmed', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/volunteer/shifts/${SEED_VOL_SHIFT_ASSIGN_ID}`);

		// Through the candidate column's search rather than its shortlist: the
		// shortlist is a convenience, and the path that has to work is "somebody
		// walked up to the desk" — a member on nobody's list because they never
		// ticked a box. Searching widens the scope on its own.
		await page.getByPlaceholder(/search by name or email/i).fill(SEED_VOL_MEMBER_NAME);
		const row = page.getByRole('listitem').filter({ hasText: SEED_VOL_MEMBER_NAME });
		await row.getByRole('button', { name: 'Add', exact: true }).click();
		await modalSubmit(page, 'Add them').click();

		// Confirmed, not claimed. A coordinator typing the name in IS the decision, and
		// leaving it claimed would cost the member the day-before reminder.
		await expect
			.poll(() => readShiftSignups(SEED_VOL_SHIFT_ASSIGN_ID), DB_POLL)
			.toMatchObject({ [SEED_VOL_MEMBER_ID]: 'confirmed' });
	});

	test('taking somebody off a shift is a cancellation, never a no-show', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/volunteer/shifts/${SEED_VOL_SHIFT_RELEASE_ID}`);

		await page.locator('button[data-button-root][aria-label="Remove"]').first().click();
		await modalSubmit(page, 'Take them off').click();

		// The distinction is the whole point: a cancellation is notice and a no-show is
		// not, and before this the only staff lever was the wrong one.
		await expect
			.poll(() => readShiftSignups(SEED_VOL_SHIFT_RELEASE_ID), DB_POLL)
			.toMatchObject({ [SEED_VOL_OTHER_MEMBER_ID]: 'cancelled' });
	});

	test('staff can log hours outside the member backdate window', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/hours');

		await page.getByRole('button', { name: 'Log hours for someone' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });

		await dialog.getByPlaceholder(/search by name or email/i).fill(SEED_VOL_NEW_MEMBER_NAME);
		await dialog.getByRole('button', { name: new RegExp(SEED_VOL_NEW_MEMBER_NAME) }).click();
		await dialog.locator('select[name="volunteerRoleId"]').selectOption({
			label: SEED_VOL_ROLE_NAME
		});

		// Well past the 90 days a member gets. The help article and this service's own
		// error both say "ask staff to add anything older"; this is that.
		const old = new Date();
		old.setDate(old.getDate() - 200);
		await dialog.locator('input[name="workedOn"]').fill(old.toISOString().slice(0, 10));
		await dialog.locator('input[name="hours"]').fill('2');
		await dialog
			.locator('textarea[name="description"]')
			.fill('E2E: taken off the paper sign-in sheet.');
		await modalSubmit(page, 'Record').click();

		// Approved on entry and attributed to the staffer — so it never appears in the
		// Pending queue the same person is standing in, which is why this reads the row.
		await expect
			.poll(() => readNewestHourLog(SEED_VOL_NEW_MEMBER_ID), DB_POLL)
			.toMatchObject({ status: 'approved', minutes: 120 });
		expect((await readNewestHourLog(SEED_VOL_NEW_MEMBER_ID))?.reviewedByUserId).toBeTruthy();
	});
});
