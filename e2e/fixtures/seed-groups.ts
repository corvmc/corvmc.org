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
import { SEED_STAFF_ID, SEED_TARGET_ID } from './seed-staff-user';
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

export const SEED_APPLY_ID = 'e2e-group-apply';
export const SEED_APPLY_SLUG = 'e2e-outreach-committee';
export const SEED_APPLY_NAME = 'E2E Outreach Committee';

const GROUP_IDS = [SEED_CLUB_ID, SEED_COMMITTEE_ID, SEED_JOINABLE_ID, SEED_APPLY_ID];
const entryIdFor = (groupId: string) => `${groupId}-entry`;

const NAMES: Record<string, string> = {
	[SEED_CLUB_ID]: SEED_CLUB_NAME,
	[SEED_COMMITTEE_ID]: SEED_COMMITTEE_NAME,
	[SEED_JOINABLE_ID]: SEED_JOINABLE_NAME,
	[SEED_APPLY_ID]: SEED_APPLY_NAME
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
				visibility: 'public' as const
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
			}
		]);
	});
}
