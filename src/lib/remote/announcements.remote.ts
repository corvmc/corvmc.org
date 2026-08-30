import { z } from 'zod';
import { query, form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireGroupRole } from '$lib/server/group/group-context';
import { requireFeature } from '$lib/server/feature-flags';
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '$lib/config';
import {
	create,
	listForManager,
	listPublished,
	publish,
	remove,
	update
} from '$lib/server/group/announcement-service';

/**
 * Announcements, for both places they are mounted.
 *
 * The forms live here rather than beside either surface because a band panel
 * page and a tab on the club page post to the *same* endpoints — that is what
 * "one implementation, two mount points" means in practice, and a second copy
 * scoped to bands is how the two would drift.
 *
 * There is deliberately **no `getAnnouncements(groupId)` query**. Both surfaces
 * already await a load-bearing page query — `getMemberGroup` for the club,
 * `getBandAnnouncementsPage` below for the panel — and a component fetching its
 * own list would be exactly the fan-out `docs/checklists/remote-query-fanout.md`
 * exists to stop. The components take their posts as a prop, which is also what
 * lets them mount in two frames.
 *
 * Every export is flag-gated on `announcements` and guarded by
 * `requireGroupRole` with an explicit `{ id }` ref. Writes require `admin`; the
 * read admits a plain member, and a staff non-member through `allowStaff`.
 */

const groupIdField = z.string().min(1);
const announcementIdField = z.string().min(1);

async function requireReader(groupId: string) {
	await requireFeature('announcements');
	return requireGroupRole({ id: groupId }, 'member', { allowStaff: true });
}

/**
 * `admin`, and **without** `allowStaff`.
 *
 * Reads admit a staff non-member because a staff member looking at a program
 * needs to see it; posting in a group's name is a different act, and one CMC
 * staff should do as a member of that group or not at all. The spec's role
 * table gives posting to owner and admin, and staff are neither.
 */
async function requireAuthor(groupId: string) {
	await requireFeature('announcements');
	return requireGroupRole({ id: groupId }, 'admin');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The `/band/{slug}/announcements` page's one load-bearing query.
 *
 * Which list you get is decided here, where the role already is, rather than
 * handed to the page as a flag it applies itself: `listForManager` includes
 * drafts, and a client-side filter over a list that contains them is one
 * refactor away from rendering an unpublished post to the whole roster.
 */
export const getBandAnnouncementsPage = query(groupIdField, async (groupId) => {
	const { role } = await requireReader(groupId);
	const canManage = role === 'owner' || role === 'admin';

	return {
		announcements: canManage ? await listForManager(groupId) : await listPublished(groupId),
		canManage
	};
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const bodyFields = {
	title: z.string().min(1, 'Give it a title').max(ANNOUNCEMENT_TITLE_MAX),
	body: z.string().min(1, 'Write something').max(ANNOUNCEMENT_BODY_MAX)
};

export const createAnnouncement = form(
	z.object({ groupId: groupIdField, ...bodyFields }),
	async (data) => {
		const { user, group } = await requireAuthor(data.groupId);
		// A draft. Publishing is its own act — see `announcement-service.ts`.
		const post = await create(group.id, user.id, { title: data.title, body: data.body });
		return { success: true, id: post.id };
	}
);

export const updateAnnouncement = form(
	z.object({ groupId: groupIdField, id: announcementIdField, ...bodyFields }),
	async (data) => {
		const { group } = await requireAuthor(data.groupId);
		try {
			await update(data.id, group.id, { title: data.title, body: data.body });
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

/**
 * The irreversible one. Everything else here can be undone; this emails the
 * roster, which cannot be.
 */
export const publishAnnouncement = form(
	z.object({ groupId: groupIdField, id: announcementIdField }),
	async (data) => {
		const { group } = await requireAuthor(data.groupId);
		try {
			await publish(data.id, group.id);
		} catch (err) {
			// `AlreadyPublishedError` is a 409, not a fault: two admins on one draft
			// is an ordinary race and must not reach Sentry as a 500.
			mapDomainError(err);
		}
		return { success: true };
	}
);

/**
 * An explicit intent rather than a `pinned` boolean.
 *
 * A required boolean in a `form()` schema does not compile under kit 2.70 —
 * checkbox inputs send nothing when unchecked, so the framework refuses any
 * boolean that is not `.optional().default(false)`. That default is right for a
 * checkbox and wrong here: this is a one-click toggle whose two directions are
 * both deliberate, and "the field was absent" must not silently mean unpin.
 */
export const pinAnnouncement = form(
	z.object({
		groupId: groupIdField,
		id: announcementIdField,
		intent: z.enum(['pin', 'unpin'])
	}),
	async (data) => {
		const { group } = await requireAuthor(data.groupId);
		try {
			await update(data.id, group.id, { pinned: data.intent === 'pin' });
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

export const deleteAnnouncement = form(
	z.object({ groupId: groupIdField, id: announcementIdField }),
	async (data) => {
		const { group } = await requireAuthor(data.groupId);
		try {
			await remove(data.id, group.id);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);
