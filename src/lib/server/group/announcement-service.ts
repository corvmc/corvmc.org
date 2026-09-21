import { and, asc, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { inboxGroupRead, inboxMessage, inboxThread } from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { groupMember } from '$lib/server/db/schema/group';
import { getNotificationType, notificationPreference } from '$lib/server/db/schema/notification';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { DomainError } from '$lib/server/domain-error';
import { renderMarkdown } from '$lib/utils/markdown';

/**
 * Announcements — a group talking to its own roster. Phase 7 of
 * `docs/specs/shipped/groups-spec.md`.
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
 *
 * **An announcement is a thread** (#1304): `channel: 'group'` with
 * `post_policy: 'leadership'`, its title in `subject` and its body in its
 * first message. `AnnouncementView` and every signature below are unchanged,
 * which is what keeps the two pages that render them out of this change.
 *
 * `post_policy` is what separates one from a chat topic, and it is in every
 * read here. Without it a band's "Tour logistics" would appear on its
 * announcements page.
 */

/**
 * The hard cap on a list, because there is no pagination yet and an uncapped
 * read of a decade of committee minutes is not a query anyone chose. A group at
 * 100 posts is the signal to add paging — see docs/specs/shipped/groups-spec.md, which
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

/**
 * The first message of a thread — the announcement's body.
 *
 * A leadership room holds one post today, but nothing stops it holding a
 * reply once discussion is turned on, so "the announcement" is explicitly the
 * earliest message rather than whichever one the join happens to return.
 */
const firstMessageOf = sql`${inboxMessage.id} = (
	SELECT m2."id" FROM "inbox_message" m2
	 WHERE m2."thread_id" = ${inboxThread.id}
	 ORDER BY m2."created_at" ASC, m2."id" ASC
	 LIMIT 1)`;

/** Only a leadership room is an announcement; a chat topic is not. */
function announcementsOf(groupId: string) {
	return and(
		eq(inboxThread.channel, 'group'),
		eq(inboxThread.groupId, groupId),
		eq(inboxThread.postPolicy, 'leadership')
	)!;
}

/** The columns every read returns, with the author resolved to a member ref. */
function selectColumns() {
	return {
		id: inboxThread.id,
		groupId: inboxThread.groupId,
		title: inboxThread.subject,
		body: inboxMessage.body,
		pinned: inboxThread.pinned,
		publishedAt: inboxThread.publishedAt,
		notifiedAt: inboxThread.notifiedAt,
		recipientCount: inboxThread.recipientCount,
		createdAt: inboxThread.createdAt,
		updatedAt: inboxThread.updatedAt,
		author: memberRefColumns()
	};
}

function runSelect(where: ReturnType<typeof and>) {
	return (
		db
			.select(selectColumns())
			.from(inboxThread)
			.innerJoin(inboxMessage, and(eq(inboxMessage.threadId, inboxThread.id), firstMessageOf))
			.leftJoin(user, eq(user.id, inboxMessage.authorUserId))
			.where(where)
			// Pinned first, then newest. A draft has no `publishedAt`, so it sorts by
			// `createdAt` — which is why both are in the order rather than one.
			.orderBy(
				desc(inboxThread.pinned),
				desc(inboxThread.publishedAt),
				desc(inboxThread.createdAt),
				desc(inboxThread.id)
			)
			.limit(MAX_LIST)
	);
}

type Row = Awaited<ReturnType<typeof runSelect>>[number];

function shape(row: Row) {
	return {
		id: row.id,
		groupId: row.groupId,
		title: row.title ?? '',
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
		and(announcementsOf(groupId), isNull(inboxThread.deletedAt), isNotNull(inboxThread.publishedAt))
	);
	return rows.map(shape);
}

/** What an owner or admin sees: drafts included. */
export async function listForManager(groupId: string): Promise<AnnouncementView[]> {
	const rows = await runSelect(and(announcementsOf(groupId), isNull(inboxThread.deletedAt)));
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
		and(eq(inboxThread.id, id), announcementsOf(groupId), isNull(inboxThread.deletedAt))
	);
	if (!row) throw new AnnouncementNotFoundError();
	return shape(row);
}

export async function create(
	groupId: string,
	authorId: string,
	data: CreateAnnouncementData
): Promise<AnnouncementView> {
	const [author] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, authorId))
		.limit(1);

	const [row] = await db
		.insert(inboxThread)
		.values({
			channel: 'group',
			groupId,
			status: 'open',
			subject: data.title.trim(),
			preview: data.body.slice(0, 120),
			pinned: data.pinned ?? false,
			// What makes it an announcement rather than a chat topic.
			postPolicy: 'leadership',
			notifyPolicy: 'email',
			messageCount: 1,
			lastMessageAt: new Date()
		})
		.returning({ id: inboxThread.id });

	await db.insert(inboxMessage).values({
		threadId: row.id,
		direction: 'peer',
		body: data.body,
		// Stored, not joined: the post outlives the account, and the timeline
		// renders this rather than re-reading `user`.
		authorName: author?.name ?? 'A former member',
		authorUserId: authorId
	});

	return getById(row.id, groupId);
}

export async function update(
	id: string,
	groupId: string,
	data: Partial<CreateAnnouncementData>
): Promise<AnnouncementView> {
	const result = await db
		.update(inboxThread)
		.set({
			...(data.title !== undefined ? { subject: data.title.trim() } : {}),
			...(data.body !== undefined ? { preview: data.body.slice(0, 120) } : {}),
			...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(inboxThread.id, id), announcementsOf(groupId), isNull(inboxThread.deletedAt)))
		.returning({ id: inboxThread.id });

	if (result.length === 0) throw new AnnouncementNotFoundError();

	// The body lives on the first message, and editing an announcement edits
	// that message rather than adding one — an edit is not a second post.
	if (data.body !== undefined) {
		const [first] = await db
			.select({ id: inboxMessage.id })
			.from(inboxMessage)
			.where(eq(inboxMessage.threadId, id))
			.orderBy(asc(inboxMessage.createdAt), asc(inboxMessage.id))
			.limit(1);
		if (first) {
			await db.update(inboxMessage).set({ body: data.body }).where(eq(inboxMessage.id, first.id));
		}
	}

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
		.update(inboxThread)
		.set({ publishedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(inboxThread.id, id),
				announcementsOf(groupId),
				isNull(inboxThread.deletedAt),
				isNull(inboxThread.publishedAt)
			)
		)
		.returning({ id: inboxThread.id });

	if (result.length === 0) {
		// Distinguish the two ways to get no row, so the admin is told which.
		const [existing] = await db
			.select({ publishedAt: inboxThread.publishedAt })
			.from(inboxThread)
			.where(and(eq(inboxThread.id, id), announcementsOf(groupId), isNull(inboxThread.deletedAt)))
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
		.update(inboxThread)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(inboxThread.id, id), announcementsOf(groupId), isNull(inboxThread.deletedAt)))
		.returning({ id: inboxThread.id });

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
		.update(inboxThread)
		.set({ notifiedAt: new Date() })
		.where(and(eq(inboxThread.id, id), isNull(inboxThread.notifiedAt)))
		.returning({ id: inboxThread.id });

	return claimed.length > 0;
}

/** Written after the send, so the number reflects what was actually attempted. */
export async function recordRecipientCount(id: string, recipientCount: number): Promise<void> {
	await db.update(inboxThread).set({ recipientCount }).where(eq(inboxThread.id, id));
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
 * The joins carry every exclusion so none of them can be forgotten by a caller:
 * a non-active membership, a member who muted this group, a member who muted
 * this one room (#1309), and a deactivated account. The author is excluded too
 * — being emailed your own post reads as a bug every time.
 *
 * A missing `notification_preference` row means the member never chose, which
 * is the common case; it coalesces to the type's own defaults here rather than
 * to a literal, so changing the default in the registry changes it everywhere.
 */
export async function listRecipients(
	groupId: string,
	authorId: string | null,
	/** The room, when the post has one. A thread nobody muted excludes nobody. */
	threadId?: string
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
		.leftJoin(
			inboxGroupRead,
			threadId
				? and(eq(inboxGroupRead.threadId, threadId), eq(inboxGroupRead.userId, user.id))
				: sql`1 = 0`
		)
		.where(
			and(
				eq(groupMember.groupId, groupId),
				eq(groupMember.status, 'active'),
				eq(groupMember.notifyAnnouncements, true),
				or(isNull(inboxGroupRead.muted), eq(inboxGroupRead.muted, false)),
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
