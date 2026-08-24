import { test, expect, type Page } from '@playwright/test';
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
	SEED_VOL_SHIFT_OPEN_NOTE,
	SEED_VOL_SHIFT_FULL_NOTE,
	SEED_VOL_SHIFT_EVENT_ID,
	SEED_VOL_EVENT_ID,
	SEED_VOL_EVENT_TITLE,
	SEED_VOL_SIGNUP_DONE_ID,
	SEED_VOL_NEW_MEMBER_EMAIL,
	SEED_VOL_MINOR_EMAIL,
	SEED_VOL_MINOR_FIRST,
	SEED_VOL_MINOR_LAST,
	SEED_VOL_BLOCKED_MINOR_EMAIL,
	SEED_VOL_BLOCKED_MINOR_FIRST,
	SEED_VOL_BLOCKED_MINOR_LAST,
	readVolunteerState,
	readSignupStatus,
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
		await page.goto('/staff/volunteer');

		const row = rowFor(page, SEED_VOL_LOG_APPROVE_DESC);
		await expect(row).toBeVisible();

		await rowAction(row, 'Approve').click();
		await modalSubmit(page, 'Approve').click();

		// The regression: the row has to leave the table, not just the counts.
		await expect(row).toHaveCount(0, { timeout: 15000 });

		const state = await readVolunteerState();
		expect(state.approveLogStatus).toBe('approved');
		// Volunteer hours are a record, not a currency. Asserted in the same test
		// as the approval rather than its own: the fixture seeds one approvable
		// log and the suite shares a database, so a second test approving "the
		// same" row finds it already gone.
		expect(state.creditRowCount).toBe(0);
	});

	test('rejecting without a reason shows written copy, not raw zod text', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer');

		const row = rowFor(page, SEED_VOL_LOG_REJECT_DESC);
		await rowAction(row, 'Return').click();
		await modalSubmit(page, 'Return').click();

		await expect(page.getByText(/give the member a reason/i)).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(/expected string to have/i)).toHaveCount(0);
	});

	test('a rejection records its reason and leaves the pending queue', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer');

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
	/** The list is navigation now; role actions live on the detail page. */
	async function openRole(page: Page, name: string) {
		await rowFor(page, name).getByRole('link', { name }).click();
		await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
	}

	test('a role with logged hours cannot be deleted, and says to archive instead', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/roles');
		await openRole(page, SEED_VOL_ROLE_NAME);

		// Delete is offered only for a role nothing was logged against, so the
		// guard is that the control is absent for one that has history.
		await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
	});

	test('an archived role stays visible to staff, behind the retired filter', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/roles');

		// Retired roles are off by default — a coordinator filling next week's
		// shifts reads the live list.
		await expect(rowFor(page, SEED_VOL_ARCHIVED_ROLE_NAME)).toHaveCount(0);

		await page.goto('/staff/volunteer/roles?retired=1');

		// But retiring a role must never hide the work done under it.
		await expect(rowFor(page, SEED_VOL_ARCHIVED_ROLE_NAME)).toBeVisible();
		await openRole(page, SEED_VOL_ARCHIVED_ROLE_NAME);
		await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
	});

	test('the role detail lists who is interested, and whether they are cleared', async ({
		page
	}) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/roles');

		// Ungated role: the member is simply on the list.
		await openRole(page, SEED_VOL_ROLE_NAME);
		await expect(page.getByText(SEED_VOL_MEMBER_NAME).first()).toBeVisible({ timeout: 15000 });

		// Gated role: same member, but holding none of what it requires — the
		// difference between "interested" and "can actually be rostered".
		await page.goto('/staff/volunteer/roles');
		await openRole(page, SEED_VOL_GATED_ROLE_NAME);
		await expect(page.getByText(SEED_VOL_MEMBER_NAME).first()).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(`needs ${SEED_VOL_CERT_NAME}`)).toBeVisible();
		await expect(page.getByText('0 of 1 ready')).toBeVisible();
	});

	test('roles are sectioned by group, with a short-staffed count', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/roles');

		// Group order comes from the enum, so "At shows" heads the first section
		// and the seeded e2e roles sit under it.
		await expect(page.getByRole('heading', { name: 'At shows' })).toBeVisible();
		await expect(rowFor(page, SEED_VOL_ROLE_NAME)).toBeVisible();

		// The open seeded shift is unclaimed, so its role reads as short. The
		// column is the reason to land here before anywhere else.
		const gatedRow = rowFor(page, SEED_VOL_GATED_ROLE_NAME);
		await expect(gatedRow).toBeVisible();
		await expect(gatedRow.locator('.badge-warning')).toBeVisible();
	});

	test('editing a role from its detail page saves', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/roles');
		await openRole(page, SEED_VOL_ROLE_NAME);

		// The edit form moved off the list into this page, so the round trip is
		// worth asserting rather than assuming.
		const order = page.locator('input[name$="displayOrder"]');
		await order.fill('4');
		await page.getByRole('button', { name: /Save/ }).click();
		await expect(page.getByText('Role updated')).toBeVisible({ timeout: 15000 });

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
		await page.goto('/staff/volunteer/roles');
		await openRole(page, SEED_VOL_ROLE_NAME);

		await page.locator('input[name$="defaultCapacity"]').fill('');
		await page.getByRole('button', { name: /Save/ }).click();
		await expect(page.getByText('Role updated')).toBeVisible({ timeout: 15000 });

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
		await expect(page.getByText('Role updated')).toBeVisible({ timeout: 15000 });
	});

	// The columns were dead in the schema before this — nothing read or wrote
	// them — so the whole path from role row to prefilled form is new.
	test("a role's shift defaults prefill the New Shift form", async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/roles');
		await openRole(page, SEED_VOL_ROLE_NAME);

		await page.getByRole('button', { name: 'New shift' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.locator('input[name="capacity"]')).toHaveValue(
			String(SEED_VOL_ROLE_DEFAULT_CAPACITY)
		);
	});

	// On the shifts board the role is chosen inside the modal, so the prefill has
	// to follow the select. The select is bound, which is also how it could break:
	// a bound value matching no option posts an empty role.
	test('the shifts board prefill follows the role picked in the modal', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/shifts');

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

	test('the retired interest route redirects onto roles', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/interest');

		await expect(page).toHaveURL(/\/staff\/volunteer\/roles$/);
	});

	test('the report counts hours logged under a since-archived role', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/volunteer/report');

		await expect(page.getByText(SEED_VOL_ARCHIVED_ROLE_NAME)).toBeVisible({ timeout: 15000 });
	});
});

test.describe('volunteering — member', () => {
	test('the interests modal renders a role job description as markdown', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		// The role picker used to sit open in the page body; it now lives behind
		// this header button so the body is shifts.
		await page.getByRole('button', { name: 'Interests' }).click();
		const modal = page.getByRole('dialog');
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

	test('a rejected log shows the member the reason', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		// Without the reason the member cannot correct and resubmit, which is why
		// the service refuses a rejection that has none.
		const row = rowFor(page, SEED_VOL_LOG_REJECTED_DESC);
		await expect(row).toBeVisible({ timeout: 15000 });
		await expect(row).toContainText(SEED_VOL_REJECTED_REASON);
	});

	test('a member can log hours and they land as pending', async ({ page }) => {
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');

		const description = `E2E logged ${Date.now()}`;
		await page.getByRole('button', { name: 'Log Hours' }).click();

		await page
			.locator('select[name="volunteerRoleId"]')
			.selectOption({ label: SEED_VOL_ROLE_NAME });
		await page.locator('input[name="hours"]').fill('1.5');
		await page.locator('textarea[name="description"]').fill(description);
		await page.getByRole('button', { name: 'Submit for review' }).click();

		const row = rowFor(page, description);
		await expect(row).toBeVisible({ timeout: 15000 });
		await expect(row).toContainText('1.5 hrs');
		// Editable only while pending — the controls are the proof of status.
		await expect(rowAction(row, 'Withdraw')).toBeVisible();
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
		await expect(page.getByRole('heading', { name: 'Shifts you can pick up' })).toBeVisible();

		// Reopening shows the selection survived the replace-all write.
		await page.getByRole('button', { name: 'Interests' }).click();
		const modal = page.getByRole('dialog');
		await expect(modal.getByRole('checkbox', { name: SEED_VOL_ROLE_NAME })).toBeChecked();
		await expect(modal.locator('textarea[name="availability"]')).toHaveValue(
			'E2E weekday evenings'
		);
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
		await expect(page.getByRole('heading', { name: 'Shifts you can pick up' })).toBeVisible({
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

		const card = shiftCard(page, SEED_VOL_SHIFT_OPEN_NOTE);
		await expect(card).toBeVisible({ timeout: 15000 });

		await card.getByRole('button', { name: "I'll do it" }).click();
		await modalSubmit(page, 'Claim it').click();

		await expect(shiftCard(page, SEED_VOL_SHIFT_OPEN_NOTE)).toContainText('claimed', {
			timeout: 15000
		});
		expect(await readSignupStatus(SEED_VOL_SHIFT_OPEN_ID)).toBe('claimed');

		// Dropping out has to free the place, not just hide the button — the
		// capacity count is computed from live signups.
		await shiftCard(page, SEED_VOL_SHIFT_OPEN_NOTE)
			.getByRole('button', { name: 'Drop out' })
			.click();
		await modalSubmit(page, 'Drop out').click();

		await expect(shiftCard(page, SEED_VOL_SHIFT_OPEN_NOTE)).toContainText("I'll do it", {
			timeout: 15000
		});
		expect(await readSignupStatus(SEED_VOL_SHIFT_OPEN_ID)).toBe('cancelled');
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

		const card = shiftCard(page, SEED_VOL_SHIFT_FULL_NOTE);
		await expect(card).toBeVisible({ timeout: 15000 });
		await expect(card).toContainText('Full');
		await expect(card.getByRole('button', { name: "I'll do it" })).toHaveCount(0);
	});

	test('staff see the claim and can confirm it', async ({ page }) => {
		// Claim as the member first, so staff have something to confirm. Separate
		// contexts rather than two logins in one: signing a second user in over an
		// existing session does not swap it.
		await login(page, SEED_VOL_MEMBER_EMAIL, SEED_VOL_MEMBER_PASSWORD);
		await page.goto('/member/volunteer');
		const card = shiftCard(page, SEED_VOL_SHIFT_OPEN_NOTE);
		await card.getByRole('button', { name: "I'll do it" }).click();
		await modalSubmit(page, 'Claim it').click();
		await expect(shiftCard(page, SEED_VOL_SHIFT_OPEN_NOTE)).toContainText('claimed', {
			timeout: 15000
		});

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
		expect(await readSignupStatus(SEED_VOL_SHIFT_OPEN_ID)).toBe('confirmed');
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
test.describe('volunteering — shifts and events', () => {
	test('the event page lists the shifts staffing that show', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/events/${SEED_VOL_EVENT_ID}`);

		const card = page.locator('.card').filter({ hasText: 'Volunteer Shifts' });
		await expect(card).toBeVisible({ timeout: 15000 });
		await expect(card).toContainText(SEED_VOL_ROLE_NAME);

		// Straight through to the shift, which is the point of the card.
		await card.getByRole('link', { name: SEED_VOL_ROLE_NAME }).click();
		await expect(page).toHaveURL(new RegExp(`/staff/volunteer/shifts/${SEED_VOL_SHIFT_EVENT_ID}$`));
	});

	test('scheduling from the event page attaches the shift to it', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto(`/staff/events/${SEED_VOL_EVENT_ID}`);

		const card = page.locator('.card').filter({ hasText: 'Volunteer Shifts' });
		await expect(card).toBeVisible({ timeout: 15000 });
		await card.getByRole('button', { name: 'Schedule a shift' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		// The event is already known here, so it is locked rather than offered —
		// there is no picker to fill in.
		await expect(dialog.getByPlaceholder('Search events by title...')).toHaveCount(0);
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
		expect(await readShiftEventId(SEED_VOL_SHIFT_EVENT_ID)).toBeNull();

		// And back on again, through the search picker this time.
		await page.getByRole('button', { name: 'Edit' }).click();
		const reopened = page.getByRole('dialog');
		// Typed, not filled. `fill()` sets the value and fires one input event;
		// bits-ui's Combobox opens its listbox off the keystrokes, so a filled
		// field searches into a popover that never appears.
		const search = reopened.getByPlaceholder('Search events by title...');
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
		expect(await readShiftEventId(SEED_VOL_SHIFT_EVENT_ID)).toBe(SEED_VOL_EVENT_ID);
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

		await expect(page.getByText(/thanks for helping us run the next one/i)).toBeVisible({
			timeout: 15000
		});

		// Second visit: the unique signupId row means asked-and-answered, and the
		// form must not be offered again.
		await page.goto(`/member/volunteer/feedback/${SEED_VOL_SIGNUP_DONE_ID}`);
		await expect(page.getByText(/already answered/i)).toBeVisible({ timeout: 15000 });
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
