import { expect, test, type Page } from './fixtures/test';
import { and, eq } from 'drizzle-orm';
import { groupMember } from '../src/lib/server/db/schema/group';
import { signInAs } from './fixtures/auth';
import { readLocalDb } from './fixtures/platform-db';
import {
	SEED_BANDMATE_EMAIL,
	SEED_BANDMATE_ID,
	SEED_BANDMATE_PASSWORD,
	SEED_MEMBERS_BAND_SLUG
} from './fixtures/seed-band-onboarding';
import {
	SEED_DRAFT_TITLE,
	SEED_LED_SLUG,
	SEED_PUBLISHED_TITLE,
	SEED_READER_ID,
	SEED_READER_SLUG
} from './fixtures/seed-groups';

/** Titles this spec types in itself, then looks for: fixture echo, not copy. */
const COMPOSED_TITLE = 'E2E composed post';
const SESSION_TITLE = 'E2E monthly jam';

/** The member's own roster flag for one group, read straight from D1. */
async function readNotifyAnnouncements(groupId: string, userId: string) {
	return readLocalDb(async (db) => {
		const [row] = await db
			.select({ notify: groupMember.notifyAnnouncements })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
			.limit(1);
		return row?.notify ?? null;
	});
}

/**
 * Announcements on the club page.
 *
 * What earns a browser here is the draft. Everything else about this feature is
 * a list, but a draft is a post the roster must not see, and the difference
 * between "not rendered" and "rendered and hidden by a class" is invisible in a
 * diff and total in effect. The server decides which list you get; this is the
 * only thing that can prove the decision reached the page.
 *
 * The second is publishing, because it is the one irreversible control in the
 * feature — 7c hangs an email to the whole roster off exactly this button.
 */

async function loginAsMember(page: Page) {
	await signInAs(page, { email: SEED_BANDMATE_EMAIL, password: SEED_BANDMATE_PASSWORD });
}

test.describe('reading announcements', () => {
	test('a plain member sees the published post, never the draft, and no way to post', async ({
		page
	}) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_READER_SLUG}`);

		// Announcements is the default tab, so the bare URL is the post list.
		// `goto` resolves before an awaited remote query commits, so wait on the
		// post rather than asserting against an empty <main>.
		await expect(page.getByText(SEED_PUBLISHED_TITLE)).toBeVisible({ timeout: 15000 });

		// The whole test. The draft is on the same group, one row away in the
		// table, and a member must not reach it by any route.
		await expect(page.getByText(SEED_DRAFT_TITLE)).toHaveCount(0);
		// And nothing on the page offers them a way to post.
		await expect(page.getByTestId('new-announcement')).toHaveCount(0);
		await expect(page.getByTestId('publish-announcement')).toHaveCount(0);
	});

	test('a leader sees the draft, marked as one', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}`);

		await expect(page.getByText(SEED_PUBLISHED_TITLE)).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(SEED_DRAFT_TITLE)).toBeVisible();
		// Marked, not merely present: an unpublished post that reads like a
		// published one is how a leader concludes they already told everybody.
		const draftCard = page.getByRole('main').locator('.card').filter({ hasText: SEED_DRAFT_TITLE });
		await expect(draftCard.getByTestId('announcement-draft')).toBeVisible();
	});
});

test.describe('writing announcements', () => {
	test('a leader writes a draft, and nothing says it was published', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}`);
		await expect(page.getByTestId('new-announcement')).toBeVisible({ timeout: 15000 });

		await page.getByTestId('new-announcement').click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('input:is([name="title"], [name^="title/"])').fill(COMPOSED_TITLE);
		await dialog
			.locator('textarea:is([name="body"], [name^="body/"])')
			.fill('Written by the composer test.');
		await dialog.locator('button[type="submit"]').click();

		// Saved as a draft, and the card says so.
		const composed = page.getByRole('main').locator('.card').filter({ hasText: COMPOSED_TITLE });
		await expect(composed).toBeVisible({ timeout: 15000 });
		await expect(composed.getByTestId('announcement-draft')).toBeVisible();
	});

	test('publishing turns a draft into a post', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}`);
		await expect(page.getByText(SEED_DRAFT_TITLE)).toBeVisible({ timeout: 15000 });

		// Scoped to the card holding the seeded draft: the page renders a Publish
		// control per draft, and by this point the composer test may have left
		// another one. Without the scope this is a strict-mode violation, and with
		// a `.first()` instead it would silently publish whichever came first.
		const draftCard = page.getByRole('main').locator('.card').filter({ hasText: SEED_DRAFT_TITLE });
		await draftCard.getByTestId('publish-announcement').click();
		await page.getByRole('dialog').locator('button[type="submit"]').click();

		// The badge is the assertion, not a toast: it is read back from the row.
		await expect(
			page
				.getByRole('main')
				.locator('.card')
				.filter({ hasText: SEED_DRAFT_TITLE })
				.getByTestId('announcement-draft')
		).toHaveCount(0, { timeout: 15000 });
	});
});

test.describe('the per-group mute', () => {
	/**
	 * The global `announcement` preference cannot express this — a member of six
	 * groups needs to silence one — so it writes their own roster row. It is also
	 * where the link in every announcement email lands, which is the whole reason
	 * these are defensible on the transactional stream.
	 */
	test('mutes one group without leaving it', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_READER_SLUG}`);

		const mute = page.getByTestId('mute-announcements');
		await expect(mute).toBeVisible({ timeout: 15000 });
		expect(await readNotifyAnnouncements(SEED_READER_ID, SEED_BANDMATE_ID)).toBe(true);
		await mute.click();
		await page.getByRole('dialog').locator('button[type="submit"]').click();

		// The roster row flips — and the member is still on the roster.
		await expect
			.poll(() => readNotifyAnnouncements(SEED_READER_ID, SEED_BANDMATE_ID), {
				timeout: 15000,
				intervals: [250, 500, 1000, 2000]
			})
			.toBe(false);
		await expect(page.getByText(SEED_PUBLISHED_TITLE)).toBeVisible();
	});
});

test.describe('the band panel mount', () => {
	/**
	 * The same component in the other frame. Worth one test because
	 * "mount-agnostic" is a claim about a prop contract, and a component that
	 * reached for a club-shaped context would fail here and nowhere else.
	 */
	test('puts Announcements in the band nav, and renders it as a band panel page', async ({
		page
	}) => {
		await loginAsMember(page);
		await page.goto(`/band/${SEED_MEMBERS_BAND_SLUG}`);

		const announcements = `/band/${SEED_MEMBERS_BAND_SLUG}/announcements`;
		await expect(page.locator(`a[href="${announcements}"]`).first()).toBeVisible({
			timeout: 15000
		});

		await page.goto(announcements);
		// Render gate: the header mounts with the awaited page query.
		await expect(page.locator('[data-page-header] h1')).toBeVisible({ timeout: 15000 });
		// A plain member of this band: they read, they do not write.
		await expect(page.getByTestId('new-announcement')).toHaveCount(0);
	});
});

test.describe('group sessions', () => {
	/**
	 * The one path outside the staff panel that reserves the room. What is worth
	 * a browser is that the reservation actually happens and is attributed to the
	 * session rather than to the program — the difference is one enum value and
	 * looks identical in a diff.
	 */
	test('a leader puts a session on the calendar and holds the room', async ({ page }) => {
		await loginAsMember(page);
		await page.goto(`/member/groups/${SEED_LED_SLUG}?tab=sessions`);

		await page.getByTestId('new-session').click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('input:is([name="title"], [name^="title/"])').fill(SESSION_TITLE);
		await dialog
			.locator('input:is([name="sessionDate"], [name^="sessionDate/"])')
			.fill('2027-03-18');
		await dialog.locator('input:is([name="startTime"], [name^="startTime/"])').fill('19:00');
		await dialog.locator('input:is([name="endTime"], [name^="endTime/"])').fill('21:00');
		// The checkbox registers with a `b:` prefix so kit coerces it to a boolean.
		await dialog.locator('input:is([name="b:reserveRoom"], [name^="b:reserveRoom/"])').check();
		await dialog.locator('button[type="submit"]').click();

		const row = page.getByRole('row').filter({ hasText: SESSION_TITLE });
		await expect(row).toBeVisible({ timeout: 15000 });
		// Read back from the row, not from a toast: this is the fact that
		// separates a session holding the room from a listing that merely says so.
		await expect(row.getByTestId('room-held')).toBeVisible();
	});
});
