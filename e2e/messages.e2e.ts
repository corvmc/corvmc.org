import { test, expect, type Page } from '@playwright/test';
import {
	SEED_MSG_PASSWORD,
	SEED_MSG_SENDER_EMAIL,
	SEED_MSG_SENDER_NAME,
	SEED_MSG_RECIPIENT_EMAIL,
	SEED_MSG_RECIPIENT_NAME,
	SEED_MSG_PORTAL_SUBJECT
} from './fixtures/seed-messaging';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

/**
 * Messaging, end to end.
 *
 * What only a round trip can prove, in order of how much it would cost to get
 * wrong:
 *
 *   1. `/member/messages` renders. Trivial to assert, and the one thing that
 *      would have caught the `messaging_standing` regression: the table was
 *      dropped out from under four hand-written SQL fragments and every
 *      member's Messages page raised "no such table", while the unit suite
 *      stayed green because it mocks `db` and never runs the SQL.
 *   2. A request is EXACTLY ONE message until accepted, and accepting is what
 *      opens the conversation. Enforced in SQL, and the protection the entire
 *      consent design rests on.
 *   3. Blocking closes the conversation without destroying it. The history has
 *      to stay readable — the person who blocked still needs it if they later
 *      decide to report.
 *   4. A DM never appears in the staff inbox. Staff see nothing until someone
 *      reports, and no unit test asserts the member-side write and the
 *      staff-side absence together.
 *   5. The staff filter survives opening a thread. The filter mirror lives in
 *      the layout now, so it keeps running while a thread is open — pinned to
 *      the index path it would navigate straight back out of whatever you just
 *      opened.
 */

const WAIT = { timeout: 15000 };

async function login(page: Page, email: string, password: string) {
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, WAIT);
}

/**
 * Log in as somebody else. `/login` bounces an already-authenticated user, so
 * the session has to go first — otherwise the "second login" quietly no-ops and
 * the rest of the test runs as the wrong account.
 */
async function switchUser(page: Page, email: string, password: string) {
	await page.context().clearCookies();
	await login(page, email, password);
}

/**
 * A message as drawn in the conversation timeline.
 *
 * Scoped to the bubble on purpose: once the list pane refreshes, the same text
 * is also the row's preview, and an unscoped match is ambiguous. Which is worth
 * knowing — it is the list refresh working.
 */
const bubble = (page: Page, text: string) => page.locator('.chat-bubble', { hasText: text });

/** Open a conversation from the list pane by the name on its row. */
async function openConversation(page: Page, name: string) {
	await page.goto('/member/messages');
	await page
		.getByRole('link', { name: new RegExp(name) })
		.first()
		.click();
	await page.waitForURL(/\/member\/messages\/[^/]+$/, WAIT);
}

test.describe('member messaging', () => {
	test('the Messages page renders for a member with no conversations', async ({ page }) => {
		await login(page, SEED_MSG_RECIPIENT_EMAIL, SEED_MSG_PASSWORD);
		await page.goto('/member/messages');

		// The regression this suite exists for was a 500, so assert the page
		// rendered rather than that some particular row is on it.
		await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible(WAIT);
		await expect(page.locator('body')).not.toContainText('no such table');
	});

	test('request, accept, reply, block', async ({ page }) => {
		const body = `E2E first contact ${Date.now()}`;

		// --- send the request, picking the recipient out of the composer ---
		await login(page, SEED_MSG_SENDER_EMAIL, SEED_MSG_PASSWORD);
		await page.goto('/member/messages');
		await page.getByRole('button', { name: 'Message a Member' }).click();

		// The picker searches the directory roster. It deliberately says nothing
		// about who accepts messages, so a match here proves reachability only in
		// the sense that the member exists and is visible.
		// `pressSequentially`, not `fill`: bits-ui's Combobox opens on real key
		// events, and a programmatic value set leaves it closed with its results
		// list unrendered.
		const picker = page.getByPlaceholder('Search members by name');
		await picker.click();
		await picker.pressSequentially('E2E Message Recip');
		await page.getByRole('option', { name: new RegExp(SEED_MSG_RECIPIENT_NAME) }).click(WAIT);
		// SearchSelect swaps the input for a badge once the pick commits; waiting for
		// that is how the test knows the choice reached the form before submitting.
		await expect(picker).toHaveCount(0, WAIT);
		await page.getByPlaceholder('Say who you are').fill(body);
		await page.getByRole('button', { name: 'Send request' }).click();

		await expect(page.getByRole('link', { name: new RegExp(SEED_MSG_RECIPIENT_NAME) })).toBeVisible(
			WAIT
		);

		// --- the recipient sees a request, not a conversation ---
		await switchUser(page, SEED_MSG_RECIPIENT_EMAIL, SEED_MSG_PASSWORD);
		await page.goto('/member/messages');
		await expect(page.getByText('Request')).toBeVisible(WAIT);

		await openConversation(page, SEED_MSG_SENDER_NAME);
		await expect(bubble(page, body)).toBeVisible(WAIT);

		// One message until accepted: the three decisions stand where the message
		// box would be, and there is no message box.
		await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible();
		await expect(page.locator('textarea[name="body"]')).toHaveCount(0);

		// --- accepting opens it ---
		await page.getByRole('button', { name: 'Accept' }).click();
		await expect(page.locator('textarea[name="body"]')).toBeVisible(WAIT);

		const reply = `E2E reply ${Date.now()}`;
		await page.locator('textarea[name="body"]').fill(reply);
		await page.getByRole('button', { name: /^Send/ }).click();
		await expect(bubble(page, reply)).toBeVisible(WAIT);

		// --- blocking closes it but keeps the history ---
		await page.getByRole('button', { name: 'Block' }).click();
		await expect(page.locator('textarea[name="body"]')).toHaveCount(0, WAIT);
		// Both messages still readable. Deleting them would take away the evidence
		// the blocker needs in order to report.
		await expect(bubble(page, body)).toBeVisible();
		await expect(bubble(page, reply)).toBeVisible();

		// --- and the block is reviewable, which is the only way to undo it ---
		await page.goto('/member/account');
		await expect(page.getByText('Blocked members')).toBeVisible(WAIT);
		await expect(page.getByRole('button', { name: 'Unblock' })).toBeVisible();

		// --- staff never see any of it ---
		await switchUser(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/inbox?status=all');
		await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible(WAIT);
		await expect(page.locator('body')).not.toContainText(body);
		await expect(page.locator('body')).not.toContainText(reply);
	});
});

test.describe('staff inbox', () => {
	test('a filter survives opening a thread, and back returns to it', async ({ page }) => {
		await login(page, SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD);
		await page.goto('/staff/inbox?status=all');
		await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible(WAIT);

		// A seeded portal thread, so this never quietly skips itself.
		await page
			.getByRole('link', { name: new RegExp(SEED_MSG_PORTAL_SUBJECT) })
			.first()
			.click();
		await page.waitForURL(/\/staff\/inbox\/[^/?]+/, WAIT);

		// The filter mirror runs in the layout, so it is live while the thread is
		// open. Pinned to the index path it would navigate straight back here.
		await expect(page).toHaveURL(/\/staff\/inbox\/[^/?]+\?status=all/, WAIT);

		await page.goBack();
		await expect(page).toHaveURL(/\/staff\/inbox\?status=all/, WAIT);
	});
});
