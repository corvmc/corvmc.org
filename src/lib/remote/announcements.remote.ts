import { z } from 'zod';
import { query, form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireGroupRole } from '$lib/server/group/group-context';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '$lib/config';
import {
	create,
	getMuteState,
	listForManager,
	listPublished,
	publish,
	remove,
	setMuteState,
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
	const { user, role } = await requireReader(groupId);
	const canManage = role === 'owner' || role === 'admin';

	const [announcements, notifyAnnouncements] = await Promise.all([
		canManage ? listForManager(groupId) : listPublished(groupId),
		// Null for a staff non-member: they have no roster row, so there is
		// nothing for them to mute and the control does not render.
		getMuteState(groupId, user.id)
	]);

	return { announcements, canManage, notifyAnnouncements };
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
		const { user, group } = await requireAuthor(data.groupId);

		let post;
		try {
			post = await publish(data.id, group.id);
		} catch (err) {
			// `AlreadyPublishedError` is a 409, not a fault: two admins on one draft
			// is an ordinary race and must not reach Sentry as a 500.
			mapDomainError(err);
		}

		// Outside the try above, and it has its own.
		//
		// The row is stamped by this point, so the admin's action succeeded. Letting
		// a fan-out failure fall into `mapDomainError` would report that success as
		// an error, and the retry it invites answers `AlreadyPublishedError` — the
		// post is out, the notification is not, and the screen says neither.
		//
		// Emitted only on the path that actually flipped the row: `publish()` writes
		// `published_at` conditionally, so an admin who lost the race threw above and
		// never reaches this. That is half of why a roster cannot be notified twice;
		// the listener's latch is the other half, and it is the half that survives
		// the bus redelivering.
		try {
			await domainEvents.emit('announcement.published', {
				announcementId: post.id,
				groupId: group.id,
				groupName: group.name,
				groupSlug: group.slug,
				groupKind: group.kind,
				title: post.title,
				body: post.body,
				authorId: post.author?.id ?? null,
				// The ref's display name, which already falls back for a deleted
				// account; the publisher's own name if the post has no author at all.
				authorName: post.author?.title ?? user.name
			});
		} catch (err) {
			captureException(err, {
				event: 'announcement.published',
				announcementId: post.id,
				groupId: group.id
			});
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

/**
 * The per-group mute.
 *
 * `requireGroupRole` at `member`, and the id comes from the session rather than
 * the request: a member may only ever change their own row, so there is no
 * `userId` field to forge. `allowStaff` is off — a staff non-member has no
 * roster row to write.
 *
 * An intent enum rather than a boolean, for the reason `pinAnnouncement` gives.
 */
export const setAnnouncementMute = form(
	z.object({ groupId: groupIdField, intent: z.enum(['mute', 'unmute']) }),
	async (data) => {
		const { user, group } = await requireGroupRole({ id: data.groupId }, 'member');
		await setMuteState(group.id, user.id, data.intent === 'unmute');
		return { success: true };
	}
);
