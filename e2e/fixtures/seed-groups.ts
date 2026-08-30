/**
 * Seed the two programs `staff-groups.e2e.ts` reads, into the LOCAL D1 database
 * used by `vite preview`.
 *
 * Its own rows rather than a borrowed band's, for the obvious reason and one
 * more: the point of these tests is that a club and a band are different kinds
 * on the same table, so a fixture that reused a band would be unable to fail.
 *
 * Neither gets a `band_site` row. That table is the premium microsite and its
 * `groupId` is NOT NULL, so a program simply not having one is the whole of the
 * constraint — and a fixture that wrote one anyway would hide a `create()` that
 * had stopped skipping it.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 * Idempotent: deletes and recreates its rows on every run.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { group, groupMember } from '../../src/lib/server/db/schema/group';
import { directoryEntry, directoryTag } from '../../src/lib/server/db/schema/directory';
import { announcement } from '../../src/lib/server/db/schema/announcement';
import { SEED_STAFF_ID, SEED_TARGET_ID } from './seed-staff-user';
import { SEED_BANDMATE_ID } from './seed-band-onboarding';
import { withPlatformEnv } from './platform-db';

export const SEED_CLUB_ID = 'e2e-group-club';
export const SEED_CLUB_SLUG = 'e2e-real-book-club';
export const SEED_CLUB_NAME = 'E2E Real Book Club';

export const SEED_COMMITTEE_ID = 'e2e-group-committee';
export const SEED_COMMITTEE_SLUG = 'e2e-programming-committee';
export const SEED_COMMITTEE_NAME = 'E2E Programming Committee';

/**
 * Two more, for the member surfaces, and they exist separately because the
 * join and apply specs *write* to them. A spec that mutates a seeded row owns
 * that row: sharing the two above would leave `staff-groups.e2e.ts` asserting
 * on a roster another spec had just changed, and restoring afterwards is not a
 * substitute — a success toast is often the previous save's, so the assertion
 * passes instantly and the restore can still be in flight when the page closes.
 */
export const SEED_JOINABLE_ID = 'e2e-group-joinable';
export const SEED_JOINABLE_SLUG = 'e2e-open-workshop';
export const SEED_JOINABLE_NAME = 'E2E Open Workshop';
export const SEED_JOINABLE_INSTRUCTIONS = 'Second Tuesday. Bring whatever you are working on.';

/** Members-only, so it has a member page and no public one. */
export const SEED_HIDDEN_ID = 'e2e-group-members-only';
export const SEED_HIDDEN_SLUG = 'e2e-members-only-circle';
export const SEED_HIDDEN_NAME = 'E2E Members Only Circle';

/**
 * Two groups for the announcement specs, and they are separate because the
 * viewer's role is the thing under test: on one the member leads and sees
 * drafts, on the other they are a plain member and must not.
 */
export const SEED_LED_ID = 'e2e-group-led';
export const SEED_LED_SLUG = 'e2e-led-workshop';
export const SEED_LED_NAME = 'E2E Led Workshop';

export const SEED_READER_ID = 'e2e-group-reader';
export const SEED_READER_SLUG = 'e2e-reader-circle';
export const SEED_READER_NAME = 'E2E Reader Circle';

/**
 * Neither title contains the word "draft". The state is shown as a badge reading
 * exactly that, and `getByText` matches case-insensitive substrings — a title
 * with "draft" in it collides with the badge and makes "is this marked as a
 * draft?" unaskable.
 */
export const SEED_PUBLISHED_TITLE = 'E2E announcement everyone can read';
export const SEED_DRAFT_TITLE = 'E2E post withheld from the roster';

export const SEED_APPLY_ID = 'e2e-group-apply';
export const SEED_APPLY_SLUG = 'e2e-outreach-committee';
export const SEED_APPLY_NAME = 'E2E Outreach Committee';

const GROUP_IDS = [
	SEED_CLUB_ID,
	SEED_COMMITTEE_ID,
	SEED_JOINABLE_ID,
	SEED_APPLY_ID,
	SEED_HIDDEN_ID,
	SEED_LED_ID,
	SEED_READER_ID
];
const entryIdFor = (groupId: string) => `${groupId}-entry`;

const NAMES: Record<string, string> = {
	[SEED_CLUB_ID]: SEED_CLUB_NAME,
	[SEED_COMMITTEE_ID]: SEED_COMMITTEE_NAME,
	[SEED_JOINABLE_ID]: SEED_JOINABLE_NAME,
	[SEED_APPLY_ID]: SEED_APPLY_NAME,
	[SEED_HIDDEN_ID]: SEED_HIDDEN_NAME,
	[SEED_LED_ID]: SEED_LED_NAME,
	[SEED_READER_ID]: SEED_READER_NAME
};

export async function seedGroups(): Promise<void> {
	await withPlatformEnv(async ({ db }) => {
		// Clean slate. Delete explicitly, and tags before entries: local D1 may
		// have foreign keys off, so no cascade can be relied on here.
		for (const groupId of GROUP_IDS) {
			await db.delete(groupMember).where(eq(groupMember.groupId, groupId));
			await db.delete(directoryTag).where(eq(directoryTag.entryId, entryIdFor(groupId)));
			await db.delete(directoryEntry).where(eq(directoryEntry.groupId, groupId));
			await db.delete(group).where(eq(group.id, groupId));
		}

		await db.insert(group).values([
			{
				id: SEED_CLUB_ID,
				kind: 'club',
				name: SEED_CLUB_NAME,
				slug: SEED_CLUB_SLUG,
				bio: 'A monthly jazz jam out of the Real Book.',
				joinPolicy: 'open',
				joinInstructions: 'Third Thursday, 7pm. Bring a horn; charts provided.'
			},
			{
				id: SEED_COMMITTEE_ID,
				kind: 'committee',
				name: SEED_COMMITTEE_NAME,
				slug: SEED_COMMITTEE_SLUG,
				bio: 'Decides what the Collective books, and when.',
				joinPolicy: 'by_application',
				joinInstructions: 'Tell us what you want to see programmed.'
			},
			{
				id: SEED_JOINABLE_ID,
				kind: 'club',
				name: SEED_JOINABLE_NAME,
				slug: SEED_JOINABLE_SLUG,
				bio: 'A drop-in workshop.',
				joinPolicy: 'open',
				joinInstructions: SEED_JOINABLE_INSTRUCTIONS
			},
			{
				id: SEED_HIDDEN_ID,
				kind: 'club',
				name: SEED_HIDDEN_NAME,
				slug: SEED_HIDDEN_SLUG,
				bio: 'Runs quietly.',
				joinPolicy: 'open',
				joinInstructions: null
			},
			{
				id: SEED_LED_ID,
				kind: 'club',
				name: SEED_LED_NAME,
				slug: SEED_LED_SLUG,
				bio: 'Led by the e2e member, so the composer has an author.',
				joinPolicy: 'invite_only',
				joinInstructions: null
			},
			{
				id: SEED_READER_ID,
				kind: 'club',
				name: SEED_READER_NAME,
				slug: SEED_READER_SLUG,
				bio: 'The e2e member is a plain member here, and must not see drafts.',
				joinPolicy: 'invite_only',
				joinInstructions: null
			},
			{
				id: SEED_APPLY_ID,
				kind: 'committee',
				name: SEED_APPLY_NAME,
				slug: SEED_APPLY_SLUG,
				bio: 'Takes the Collective out into the world.',
				joinPolicy: 'by_application',
				joinInstructions: 'Say what you would like to work on.'
			}
		]);

		await db.insert(directoryEntry).values(
			GROUP_IDS.map((groupId) => ({
				id: entryIdFor(groupId),
				groupId,
				name: NAMES[groupId],
				// One deliberately not public, so the directory's filter and the
				// public page's 404 both have something to be wrong about.
				visibility: groupId === SEED_HIDDEN_ID ? ('members' as const) : ('public' as const)
			}))
		);

		await db.insert(groupMember).values([
			// The staff user leads the club, so the detail page has an owner to
			// render and the "no leader" branch is not the only one exercised.
			{
				id: `${SEED_CLUB_ID}-owner`,
				groupId: SEED_CLUB_ID,
				userId: SEED_STAFF_ID,
				role: 'owner',
				status: 'active'
			},
			{
				id: `${SEED_COMMITTEE_ID}-owner`,
				groupId: SEED_COMMITTEE_ID,
				userId: SEED_STAFF_ID,
				role: 'owner',
				status: 'active'
			},
			// The application the committee is waiting on. `'requested'`, not
			// `'pending'`: same waiting state, opposite direction, and the roster
			// has to render them apart.
			{
				id: `${SEED_COMMITTEE_ID}-applicant`,
				groupId: SEED_COMMITTEE_ID,
				userId: SEED_TARGET_ID,
				role: 'member',
				status: 'requested'
			},
			// The two the member specs write to get a leader as well, so their
			// rosters are not empty and the pages have something to render either
			// side of the change under test.
			{
				id: `${SEED_JOINABLE_ID}-owner`,
				groupId: SEED_JOINABLE_ID,
				userId: SEED_STAFF_ID,
				role: 'owner',
				status: 'active'
			},
			{
				id: `${SEED_APPLY_ID}-owner`,
				groupId: SEED_APPLY_ID,
				userId: SEED_STAFF_ID,
				role: 'owner',
				status: 'active'
			},
			// The two announcement groups, and the whole point is the role.
			{
				id: `${SEED_LED_ID}-owner`,
				groupId: SEED_LED_ID,
				userId: SEED_BANDMATE_ID,
				role: 'owner',
				status: 'active'
			},
			{
				id: `${SEED_READER_ID}-owner`,
				groupId: SEED_READER_ID,
				userId: SEED_STAFF_ID,
				role: 'owner',
				status: 'active'
			},
			{
				id: `${SEED_READER_ID}-member`,
				groupId: SEED_READER_ID,
				userId: SEED_BANDMATE_ID,
				role: 'member',
				status: 'active'
			}
		]);

		// One published post and one draft on each, so "a member sees the post but
		// not the draft" and "a leader sees both" are the same fixture read twice.
		// `notifiedAt` stays null: it is the fan-out latch, and nothing has sent.
		await db.insert(announcement).values(
			[SEED_LED_ID, SEED_READER_ID].flatMap((groupId) => [
				{
					id: `${groupId}-published`,
					groupId,
					authorId: SEED_STAFF_ID,
					title: SEED_PUBLISHED_TITLE,
					body: 'Everyone on the roster can read this one.',
					publishedAt: new Date('2026-08-01T00:00:00Z')
				},
				{
					id: `${groupId}-draft`,
					groupId,
					authorId: SEED_STAFF_ID,
					title: SEED_DRAFT_TITLE,
					body: 'Nobody outside the leadership should ever see this.',
					publishedAt: null
				}
			])
		);
	});
}
