import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { announcement } from '$lib/server/db/schema/announcement';
import { user } from '$lib/server/db/schema/authentication';
import { groupMember } from '$lib/server/db/schema/group';
import { getNotificationType, notificationPreference } from '$lib/server/db/schema/notification';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { DomainError } from '$lib/server/domain-error';
import { renderMarkdown } from '$lib/utils/markdown';

/**
 * Announcements — a group talking to its own roster. Phase 7 of
 * `docs/specs/groups-spec.md`.
 *
 * The whole module is group-scoped by argument: every function takes a
 * `groupId` and every write is scoped to it. Nothing here guards — that is
 * `requireGroupRole`'s job at the remote boundary, and doing it in both places
 * is how two answers to "may this person post" come to disagree.
 *
 * **Publishing is a separate act from writing.** A row exists as a draft until
 * `publish()` stamps `publishedAt`, because the fan-out is irreversible: an
 * announcement emailed to 200 people cannot be unsent, and an editor that
 * notified on every keystroke-save would make that the default. Nothing reaches
 * a member before `publishedAt` is set.
 */

/**
 * The hard cap on a list, because there is no pagination yet and an uncapped
 * read of a decade of committee minutes is not a query anyone chose. A group at
 * 100 posts is the signal to add paging — see docs/specs/groups-spec.md, which
 * names it as the first thing to add if a club stops being small.
 */
const MAX_LIST = 100;

export class AnnouncementNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Announcement not found');
		this.name = 'AnnouncementNotFoundError';
	}
}

/**
 * Publishing twice. An ordinary state — two admins on the same draft, or a
 * double submit — not a fault, so it must not reach Sentry as a 500. It is also
 * the check that keeps the fan-out honest: `publish()` is what emits, and
 * emitting twice would notify a roster twice.
 */
export class AlreadyPublishedError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This announcement has already been published.');
		this.name = 'AlreadyPublishedError';
	}
}

export interface CreateAnnouncementData {
	title: string;
	body: string;
	pinned?: boolean;
}

/** The columns every read returns, with the author resolved to a member ref. */
function selectColumns() {
	return {
		id: announcement.id,
		groupId: announcement.groupId,
		title: announcement.title,
		body: announcement.body,
		pinned: announcement.pinned,
		publishedAt: announcement.publishedAt,
		notifiedAt: announcement.notifiedAt,
		recipientCount: announcement.recipientCount,
		createdAt: announcement.createdAt,
		updatedAt: announcement.updatedAt,
		author: memberRefColumns()
	};
}

function runSelect(where: ReturnType<typeof and>) {
	return (
		db
			.select(selectColumns())
			.from(announcement)
			.leftJoin(user, eq(user.id, announcement.authorId))
			.where(where)
			// Pinned first, then newest. A draft has no `publishedAt`, so it sorts by
			// `createdAt` — which is why both are in the order rather than one.
			.orderBy(
				desc(announcement.pinned),
				desc(announcement.publishedAt),
				desc(announcement.createdAt)
			)
			.limit(MAX_LIST)
	);
}

type Row = Awaited<ReturnType<typeof runSelect>>[number];

function shape(row: Row) {
	return {
		id: row.id,
		groupId: row.groupId,
		title: row.title,
		body: row.body,
		/** Sanitized on the way out — `renderMarkdown` runs the allowlist filter. */
		bodyHtml: renderMarkdown(row.body),
		pinned: row.pinned,
		publishedAt: row.publishedAt,
		notifiedAt: row.notifiedAt,
		recipientCount: row.recipientCount,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		// Null once the author's account is gone. The post is still the group's.
		author: row.author?.id ? toMemberRef(row.author) : null
	};
}

export type AnnouncementView = ReturnType<typeof shape>;

/**
 * What a member sees: published, not deleted.
 *
 * Drafts are deliberately absent rather than filtered in the caller. A member
 * list and an editor list differ by more than a flag, and one function returning
 * both behind a boolean is how a draft ends up rendered to the roster.
 */
export async function listPublished(groupId: string): Promise<AnnouncementView[]> {
	const rows = await runSelect(
		and(
			eq(announcement.groupId, groupId),
			isNull(announcement.deletedAt),
			isNotNull(announcement.publishedAt)
		)
	);
	return rows.map(shape);
}

/** What an owner or admin sees: drafts included. */
export async function listForManager(groupId: string): Promise<AnnouncementView[]> {
	const rows = await runSelect(
		and(eq(announcement.groupId, groupId), isNull(announcement.deletedAt))
	);
	return rows.map(shape);
}

/**
 * One announcement, scoped to its group.
 *
 * `groupId` is not decorative: the caller's guard proves they administer *a*
 * group, so an id alone would let an admin of one group read or edit another's
 * draft. The same argument `group_invite.revoke` carries.
 */
export async function getById(id: string, groupId: string): Promise<AnnouncementView> {
	const [row] = await runSelect(
		and(eq(announcement.id, id), eq(announcement.groupId, groupId), isNull(announcement.deletedAt))
	);
	if (!row) throw new AnnouncementNotFoundError();
	return shape(row);
}

export async function create(
	groupId: string,
	authorId: string,
	data: CreateAnnouncementData
): Promise<AnnouncementView> {
	const [row] = await db
		.insert(announcement)
		.values({
			groupId,
			authorId,
			title: data.title.trim(),
			body: data.body,
			pinned: data.pinned ?? false
		})
		.returning({ id: announcement.id });

	return getById(row.id, groupId);
}

export async function update(
	id: string,
	groupId: string,
	data: Partial<CreateAnnouncementData>
): Promise<AnnouncementView> {
	const result = await db
		.update(announcement)
		.set({
			...(data.title !== undefined ? { title: data.title.trim() } : {}),
			...(data.body !== undefined ? { body: data.body } : {}),
			...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
			updatedAt: new Date()
		})
		.where(
			and(
				eq(announcement.id, id),
				eq(announcement.groupId, groupId),
				isNull(announcement.deletedAt)
			)
		)
		.returning({ id: announcement.id });

	if (result.length === 0) throw new AnnouncementNotFoundError();
	return getById(id, groupId);
}

/**
 * Stamp `publishedAt` and hand the caller what the fan-out needs.
 *
 * Conditional on `published_at IS NULL` in the UPDATE itself rather than a
 * SELECT first: two admins clicking Publish on the same draft would otherwise
 * both pass the check and both emit, and the roster would be notified twice.
 * No row back means somebody got there first.
 */
export async function publish(id: string, groupId: string): Promise<AnnouncementView> {
	const result = await db
		.update(announcement)
		.set({ publishedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(announcement.id, id),
				eq(announcement.groupId, groupId),
				isNull(announcement.deletedAt),
				isNull(announcement.publishedAt)
			)
		)
		.returning({ id: announcement.id });

	if (result.length === 0) {
		// Distinguish the two ways to get no row, so the admin is told which.
		const [existing] = await db
			.select({ publishedAt: announcement.publishedAt })
			.from(announcement)
			.where(
				and(
					eq(announcement.id, id),
					eq(announcement.groupId, groupId),
					isNull(announcement.deletedAt)
				)
			)
			.limit(1);
		if (existing) throw new AlreadyPublishedError();
		throw new AnnouncementNotFoundError();
	}

	return getById(id, groupId);
}

/**
 * Soft delete. The post comes off the tab and stops being editable; the row
 * stays, because a committee's announcements are part of the record of the
 * committee and "we never said that" is not a claim a delete button should be
 * able to make.
 */
export async function remove(id: string, groupId: string): Promise<void> {
	const result = await db
		.update(announcement)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(announcement.id, id),
				eq(announcement.groupId, groupId),
				isNull(announcement.deletedAt)
			)
		)
		.returning({ id: announcement.id });

	if (result.length === 0) throw new AnnouncementNotFoundError();
}

// ---------------------------------------------------------------------------
// The fan-out
// ---------------------------------------------------------------------------

/**
 * Claim an announcement for notification, exactly once.
 *
 * The event bus delivers at least once, so the listener can run twice for one
 * publish — a roster emailed twice is the failure this prevents, and it cannot
 * be prevented by checking `notifiedAt` and then writing it, because two
 * invocations interleave between the read and the write. `WHERE notified_at IS
 * NULL` in the UPDATE makes the database decide. No row back means somebody
 * else is already sending; that is an ordinary outcome, not an error.
 */
export async function claimForNotification(id: string): Promise<boolean> {
	const claimed = await db
		.update(announcement)
		.set({ notifiedAt: new Date() })
		.where(and(eq(announcement.id, id), isNull(announcement.notifiedAt)))
		.returning({ id: announcement.id });

	return claimed.length > 0;
}

/** Written after the send, so the number reflects what was actually attempted. */
export async function recordRecipientCount(id: string, recipientCount: number): Promise<void> {
	await db.update(announcement).set({ recipientCount }).where(eq(announcement.id, id));
}

export interface AnnouncementRecipient {
	userId: string;
	name: string;
	email: string;
	emailEnabled: boolean;
	inAppEnabled: boolean;
}

/**
 * Everyone who should hear about this post, in **one** query.
 *
 * `dispatch()` in a loop does not work at group scale: per recipient it is a
 * preference SELECT, a notification INSERT, an SSE push and one outbound HTTPS
 * call, all awaited serially — roughly 600 sequential subrequests for a
 * 200-member group, against a 1000-subrequest ceiling.
 *
 * The joins carry all three exclusions so none of them can be forgotten by a
 * caller: a non-active membership, a member who muted this group, and a
 * deactivated account. The author is excluded too — being emailed your own post
 * reads as a bug every time.
 *
 * A missing `notification_preference` row means the member never chose, which
 * is the common case; it coalesces to the type's own defaults here rather than
 * to a literal, so changing the default in the registry changes it everywhere.
 */
export async function listRecipients(
	groupId: string,
	authorId: string | null
): Promise<AnnouncementRecipient[]> {
	const defaults = getNotificationType('announcement')?.defaults ?? {
		email: true,
		inApp: true,
		sms: false
	};

	const rows = await db
		.select({
			userId: user.id,
			name: user.name,
			email: user.email,
			emailEnabled: notificationPreference.emailEnabled,
			inAppEnabled: notificationPreference.inAppEnabled
		})
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.leftJoin(
			notificationPreference,
			and(
				eq(notificationPreference.userId, user.id),
				eq(notificationPreference.notificationType, 'announcement')
			)
		)
		.where(
			and(
				eq(groupMember.groupId, groupId),
				eq(groupMember.status, 'active'),
				eq(groupMember.notifyAnnouncements, true),
				isNull(user.deletedAt),
				authorId ? ne(user.id, authorId) : undefined
			)
		);

	return rows.map((r) => ({
		userId: r.userId,
		name: r.name,
		email: r.email,
		emailEnabled: r.emailEnabled ?? defaults.email,
		inAppEnabled: r.inAppEnabled ?? defaults.inApp
	}));
}

// ---------------------------------------------------------------------------
// The per-group mute
// ---------------------------------------------------------------------------

/**
 * Whether this member wants announcements from this group.
 *
 * Defaults to true for a row that has none — but the column is `NOT NULL
 * DEFAULT true`, so that case is a member who is not on the roster at all
 * (staff reading the page), for whom there is nothing to mute.
 */
export async function getMuteState(groupId: string, userId: string): Promise<boolean | null> {
	const [row] = await db
		.select({ notify: groupMember.notifyAnnouncements })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
		.limit(1);

	return row?.notify ?? null;
}

/**
 * Mute or unmute one group for one member.
 *
 * Scoped to the pair, and the pair is the whole authorization: a member may
 * only ever change their own row, so the caller passes the id from the session
 * rather than from the request.
 */
export async function setMuteState(
	groupId: string,
	userId: string,
	notify: boolean
): Promise<void> {
	await db
		.update(groupMember)
		.set({ notifyAnnouncements: notify, updatedAt: new Date() })
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)));
}
