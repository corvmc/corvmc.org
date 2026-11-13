import { and, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	groupAnnouncement,
	inboxGroupRead,
	inboxMessage,
	inboxThread
} from '#lib/server/db/schema/inbox.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { groupMember } from '#lib/server/db/schema/group.js';
import { getNotificationType, notificationPreference } from '#lib/server/db/schema/notification.js';
import { memberRefColumns, toMemberRef } from '#lib/server/entity/refs.js';
import { DomainError } from '#lib/server/domain-error.js';
import { renderMarkdown } from '#lib/utils/markdown.js';
import { messagePreview } from '#lib/server/inbox/thread-service.js';
import { ANNOUNCEMENTS_TOPIC } from '#lib/server/inbox/group-chat-service.js';

/**
 * Announcements — a group talking to its own roster. See
 * `docs/decisions/0023-group-announcements-are-transactional-and-batched.md`
 * and, for where a post lands, `0050-one-announcements-thread-per-group.md`.
 *
 * Group-scoped by argument: every function takes a `groupId` and every write
 * is scoped to it. Nothing here guards — `requireGroupRole` does.
 *
 * **A row is a draft until `publish()`**, because the fan-out is
 * irreversible. Publishing posts the announcement as one message in the
 * group's single Announcements thread (#2618), title first.
 */

/** The hard cap on a list, because there is no pagination yet. */
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

/** What a reader sees in the thread: the title as the first line. */
export function announcementMessageBody(title: string, body: string): string {
	return `${title}\n\n${body}`;
}

/** The group's one leadership room: `idx_inbox_thread_group_announcements`. */
function announcementThreadWhere(groupId: string) {
	return and(
		eq(inboxThread.channel, 'group'),
		eq(inboxThread.groupId, groupId),
		eq(inboxThread.postPolicy, 'leadership')
	)!;
}

export async function findAnnouncementThread(groupId: string): Promise<string | null> {
	const [row] = await db
		.select({ id: inboxThread.id })
		.from(inboxThread)
		.where(announcementThreadWhere(groupId))
		.limit(1);
	return row?.id ?? null;
}

/**
 * The group's Announcements thread, created on its first post. The unique
 * index decides a race: the loser's insert does nothing and reads the winner's.
 */
export async function getOrCreateAnnouncementThread(groupId: string): Promise<string> {
	await db
		.insert(inboxThread)
		.values({
			channel: 'group',
			groupId,
			status: 'open',
			subject: ANNOUNCEMENTS_TOPIC,
			postPolicy: 'leadership',
			notifyPolicy: 'email'
		})
		.onConflictDoNothing();
	const id = await findAnnouncementThread(groupId);
	if (!id) throw new Error(`No announcements thread for group ${groupId}`);
	return id;
}

/** The columns every read returns, with the author resolved to a member ref. */
function selectColumns() {
	return {
		id: groupAnnouncement.id,
		groupId: groupAnnouncement.groupId,
		title: groupAnnouncement.title,
		body: groupAnnouncement.body,
		pinned: groupAnnouncement.pinned,
		publishedAt: groupAnnouncement.publishedAt,
		notifiedAt: groupAnnouncement.notifiedAt,
		recipientCount: groupAnnouncement.recipientCount,
		createdAt: groupAnnouncement.createdAt,
		updatedAt: groupAnnouncement.updatedAt,
		author: memberRefColumns()
	};
}

function runSelect(where: ReturnType<typeof and>) {
	return (
		db
			.select(selectColumns())
			.from(groupAnnouncement)
			.leftJoin(user, eq(user.id, groupAnnouncement.authorUserId))
			.where(where)
			// Pinned first, then newest. A draft has no `publishedAt`, so it sorts by
			// `createdAt` — which is why both are in the order rather than one.
			.orderBy(
				desc(groupAnnouncement.pinned),
				desc(groupAnnouncement.publishedAt),
				desc(groupAnnouncement.createdAt),
				desc(groupAnnouncement.id)
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

const live = (id: string, groupId: string) =>
	and(
		eq(groupAnnouncement.id, id),
		eq(groupAnnouncement.groupId, groupId),
		isNull(groupAnnouncement.deletedAt)
	);

/**
 * What a member sees: published, not deleted. Drafts are absent here rather
 * than filtered by a caller, so a draft cannot be rendered to the roster.
 */
export async function listPublished(groupId: string): Promise<AnnouncementView[]> {
	const rows = await runSelect(
		and(
			eq(groupAnnouncement.groupId, groupId),
			isNull(groupAnnouncement.deletedAt),
			isNotNull(groupAnnouncement.publishedAt)
		)
	);
	return rows.map(shape);
}

/** What an owner or admin sees: drafts included. */
export async function listForManager(groupId: string): Promise<AnnouncementView[]> {
	const rows = await runSelect(
		and(eq(groupAnnouncement.groupId, groupId), isNull(groupAnnouncement.deletedAt))
	);
	return rows.map(shape);
}

/**
 * One announcement, scoped to its group: the caller's guard proves they
 * administer *a* group, so an id alone would reach another group's draft.
 */
export async function getById(id: string, groupId: string): Promise<AnnouncementView> {
	const [row] = await runSelect(live(id, groupId));
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
		.insert(groupAnnouncement)
		.values({
			groupId,
			title: data.title.trim(),
			body: data.body,
			pinned: data.pinned ?? false,
			authorUserId: authorId,
			authorName: author?.name ?? 'A former member'
		})
		.returning({ id: groupAnnouncement.id });

	return getById(row.id, groupId);
}

/** Edits a published post's message too: an edit is not a second post. */
export async function update(
	id: string,
	groupId: string,
	data: Partial<CreateAnnouncementData>
): Promise<AnnouncementView> {
	const [row] = await db
		.update(groupAnnouncement)
		.set({
			...(data.title !== undefined ? { title: data.title.trim() } : {}),
			...(data.body !== undefined ? { body: data.body } : {}),
			...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
			updatedAt: new Date()
		})
		.where(live(id, groupId))
		.returning({
			title: groupAnnouncement.title,
			body: groupAnnouncement.body,
			messageId: groupAnnouncement.messageId
		});

	if (!row) throw new AnnouncementNotFoundError();

	if (row.messageId && (data.title !== undefined || data.body !== undefined)) {
		await db
			.update(inboxMessage)
			.set({ body: announcementMessageBody(row.title, row.body) })
			.where(eq(inboxMessage.id, row.messageId));
	}

	return getById(id, groupId);
}

/**
 * Stamp `publishedAt`, then post the message into the Announcements thread.
 *
 * The stamp is conditional on `published_at IS NULL` in the UPDATE itself, so
 * of two admins publishing one draft only one gets a row back, and only that
 * one posts and emits.
 */
export async function publish(id: string, groupId: string): Promise<AnnouncementView> {
	const now = new Date();
	const [stamped] = await db
		.update(groupAnnouncement)
		.set({ publishedAt: now, updatedAt: now })
		.where(and(live(id, groupId), isNull(groupAnnouncement.publishedAt)))
		.returning({
			title: groupAnnouncement.title,
			body: groupAnnouncement.body,
			authorUserId: groupAnnouncement.authorUserId,
			authorName: groupAnnouncement.authorName
		});

	if (!stamped) {
		// Distinguish the two ways to get no row, so the admin is told which.
		const [existing] = await db
			.select({ id: groupAnnouncement.id })
			.from(groupAnnouncement)
			.where(live(id, groupId))
			.limit(1);
		if (existing) throw new AlreadyPublishedError();
		throw new AnnouncementNotFoundError();
	}

	const threadId = await getOrCreateAnnouncementThread(groupId);
	const messageId = crypto.randomUUID();
	const body = announcementMessageBody(stamped.title, stamped.body);
	await db.batch([
		db.insert(inboxMessage).values({
			id: messageId,
			threadId,
			direction: 'peer',
			body,
			authorName: stamped.authorName,
			authorUserId: stamped.authorUserId,
			createdAt: now
		}),
		db.update(groupAnnouncement).set({ messageId }).where(eq(groupAnnouncement.id, id)),
		db
			.update(inboxThread)
			.set({
				preview: messagePreview(body, 'group'),
				messageCount: sql`${inboxThread.messageCount} + 1`,
				lastMessageAt: now,
				updatedAt: now
			})
			.where(eq(inboxThread.id, threadId))
	]);

	return getById(id, groupId);
}

/**
 * Soft delete. The post comes off the tab and out of the thread; the row
 * stays, because a group's announcements are part of its record.
 */
export async function remove(id: string, groupId: string): Promise<void> {
	const [row] = await db
		.select({ messageId: groupAnnouncement.messageId, threadId: inboxMessage.threadId })
		.from(groupAnnouncement)
		.leftJoin(inboxMessage, eq(inboxMessage.id, groupAnnouncement.messageId))
		.where(live(id, groupId))
		.limit(1);
	if (!row) throw new AnnouncementNotFoundError();

	const withdraw = db
		.update(groupAnnouncement)
		.set({ deletedAt: new Date(), updatedAt: new Date(), messageId: null })
		.where(live(id, groupId));
	if (!row.messageId || !row.threadId) {
		await withdraw;
		return;
	}

	const latest = (column: typeof inboxMessage.body | typeof inboxMessage.createdAt) =>
		sql`(SELECT ${column} FROM ${inboxMessage} WHERE ${inboxMessage.threadId} = ${row.threadId}
		     ORDER BY ${inboxMessage.createdAt} DESC, ${inboxMessage.id} DESC LIMIT 1)`;
	await db.batch([
		withdraw,
		db.delete(inboxMessage).where(eq(inboxMessage.id, row.messageId)),
		db
			.update(inboxThread)
			.set({
				messageCount: sql`(SELECT count(*) FROM ${inboxMessage} WHERE ${inboxMessage.threadId} = ${row.threadId})`,
				lastMessageAt: latest(inboxMessage.createdAt),
				preview: sql`substr(${latest(inboxMessage.body)}, 1, 120)`,
				updatedAt: new Date()
			})
			.where(eq(inboxThread.id, row.threadId))
	]);
}

// ---------------------------------------------------------------------------
// The fan-out
// ---------------------------------------------------------------------------

/**
 * Claim an announcement for notification, exactly once. The bus delivers at
 * least once; `WHERE notified_at IS NULL` in the UPDATE makes the database
 * decide, and no row back means another invocation is already sending.
 */
export async function claimForNotification(id: string): Promise<boolean> {
	const claimed = await db
		.update(groupAnnouncement)
		.set({ notifiedAt: new Date() })
		.where(and(eq(groupAnnouncement.id, id), isNull(groupAnnouncement.notifiedAt)))
		.returning({ id: groupAnnouncement.id });

	return claimed.length > 0;
}

/** Written after the send, so the number reflects what was actually attempted. */
export async function recordRecipientCount(id: string, recipientCount: number): Promise<void> {
	await db.update(groupAnnouncement).set({ recipientCount }).where(eq(groupAnnouncement.id, id));
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
