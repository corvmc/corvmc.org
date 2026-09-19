import { and, asc, count, desc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { inboxThread, inboxMessage, inboxGroupRead } from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
import { touchThread } from './message-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';

/**
 * The threads a group's members share (#1252), several per group since #1301.
 * A **topic** is an `inbox_thread` with `channel: 'group'`, the group's id
 * and a `subject`; a null subject is General, which is what every group had
 * before topics, so nothing had to be migrated. `channel: 'group'` and never
 * `'band'` — that one means a stranger used the booking form. **Nothing here
 * gates**; `requireGroupRole` does.
 */

/** What a null subject is called wherever a topic is named. */
export const GENERAL_TOPIC = 'General';

/** Every topic in one group, General first and then most recent. */
function topicsOf(groupId: string) {
	return and(eq(inboxThread.channel, 'group'), eq(inboxThread.groupId, groupId))!;
}

/**
 * The group's General topic, creating it on first use.
 *
 * Scoped to `subject IS NULL`, which is what keeps it from picking up a named
 * topic — before topics there was one thread per group and the lookup did not
 * have to say so.
 */
export async function getOrCreateGroupChat(groupId: string): Promise<string> {
	const [existing] = await db
		.select({ id: inboxThread.id })
		.from(inboxThread)
		.where(and(topicsOf(groupId), isNull(inboxThread.subject)))
		.limit(1);
	if (existing) return existing.id;

	const [created] = await db
		.insert(inboxThread)
		.values({ channel: 'group', groupId, status: 'open' })
		.returning({ id: inboxThread.id });
	return created.id;
}

export interface GroupTopic {
	id: string;
	/** Null is General — see the note above. */
	subject: string | null;
	name: string;
	isGeneral: boolean;
	messageCount: number;
	lastMessageAt: Date | null;
	unread: boolean;
}

/**
 * Every topic in a group, with this reader's unread mark.
 *
 * General is pinned first however quiet it gets — a landing place that moves
 * is worse than a stale one — and the rest are newest-activity-first. The
 * General row is created on read, as it always was.
 */
export async function listGroupTopics(groupId: string, userId: string): Promise<GroupTopic[]> {
	await getOrCreateGroupChat(groupId);

	const rows = await db
		.select({
			id: inboxThread.id,
			subject: inboxThread.subject,
			messageCount: inboxThread.messageCount,
			lastMessageAt: inboxThread.lastMessageAt,
			lastReadAt: inboxGroupRead.lastReadAt
		})
		.from(inboxThread)
		.leftJoin(
			inboxGroupRead,
			and(eq(inboxGroupRead.threadId, inboxThread.id), eq(inboxGroupRead.userId, userId))
		)
		.where(topicsOf(groupId))
		.orderBy(
			// `subject IS NULL` sorts 1 before 0 ascending, so General leads.
			desc(sql`${inboxThread.subject} is null`),
			desc(inboxThread.lastMessageAt),
			asc(inboxThread.id)
		);

	return rows.map((r) => ({
		id: r.id,
		subject: r.subject,
		name: r.subject ?? GENERAL_TOPIC,
		isGeneral: r.subject === null,
		messageCount: r.messageCount,
		lastMessageAt: r.lastMessageAt,
		// Never read at all counts as unread only once something has been said,
		// or every empty topic would wear a dot the moment it is created.
		unread: r.lastMessageAt !== null && (r.lastReadAt === null || r.lastMessageAt > r.lastReadAt)
	}));
}

export class TopicNameTakenError extends Error {
	readonly httpStatus = 409;
	constructor() {
		super('This group already has a topic with that name.');
		this.name = 'TopicNameTakenError';
	}
}

/**
 * Open a named topic. The name is unique within the group,
 * case-insensitively: "Tour" and "tour" are a mistake every time and the list
 * cannot tell them apart. `General` is refused because a null subject is
 * already called that, and a second one would be unreachable beside it.
 */
export async function createGroupTopic(groupId: string, subject: string): Promise<string> {
	const name = subject.trim();

	const clash = await db
		.select({ id: inboxThread.id })
		.from(inboxThread)
		.where(and(topicsOf(groupId), sql`lower(${inboxThread.subject}) = lower(${name})`))
		.limit(1);
	if (clash.length > 0 || name.toLowerCase() === GENERAL_TOPIC.toLowerCase()) {
		throw new TopicNameTakenError();
	}

	const [created] = await db
		.insert(inboxThread)
		.values({ channel: 'group', groupId, status: 'open', subject: name })
		.returning({ id: inboxThread.id });
	return created.id;
}

export interface GroupChatMessage {
	id: string;
	body: string;
	direction: 'peer';
	authorName: string | null;
	authorUserId: string | null;
	createdAt: Date;
}

/**
 * The thread and its messages, oldest first.
 *
 * Unpaginated on purpose for now: a group's chat is one conversation, and
 * `ThreadTimeline` scrolls it. A group that outgrows one page is the signal to
 * page it, and there is none yet.
 */
export async function getGroupChat(groupId: string, threadId?: string) {
	// No topic named means General, which is where `/…/chat` lands.
	const id = threadId ?? (await getOrCreateGroupChat(groupId));

	const messages = await db
		.select({
			id: inboxMessage.id,
			body: inboxMessage.body,
			direction: inboxMessage.direction,
			authorName: inboxMessage.authorName,
			authorUserId: inboxMessage.authorUserId,
			createdAt: inboxMessage.createdAt
		})
		.from(inboxMessage)
		.where(eq(inboxMessage.threadId, id))
		.orderBy(asc(inboxMessage.createdAt), asc(inboxMessage.id));

	const [topic] = await db
		.select({ subject: inboxThread.subject })
		.from(inboxThread)
		.where(eq(inboxThread.id, id))
		.limit(1);

	const [g] = await db
		.select({ name: group.name })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);

	return {
		id,
		groupName: g?.name ?? 'This group',
		topicName: topic?.subject ?? GENERAL_TOPIC,
		isGeneral: (topic?.subject ?? null) === null,
		messages: messages as GroupChatMessage[]
	};
}

/**
 * Post to the group's chat.
 *
 * Not `addPeerMessage`: that emits `inbox.direct_message` naming one
 * recipient, which is neither true nor safe here — a chat has as many
 * recipients as the roster, and the DM event carries preview text a listener
 * fans out to exactly one person.
 */
export async function postToGroupChat(params: {
	groupId: string;
	groupName: string;
	userId: string;
	userName: string;
	body: string;
	/** Which topic. Omitted means General, for a caller that has no topic. */
	threadId?: string;
}): Promise<{ messageId: string }> {
	const threadId = params.threadId ?? (await getOrCreateGroupChat(params.groupId));

	const [message] = await db
		.insert(inboxMessage)
		.values({
			threadId,
			direction: 'peer',
			body: params.body,
			authorName: params.userName,
			authorUserId: params.userId
		})
		.returning({ id: inboxMessage.id });

	await touchThread(threadId, params.body);
	// Your own message is read the moment you send it, or the sender's own
	// badge lights for something they just wrote.
	await markGroupChatRead(threadId, params.userId);

	// The roster minus the author, resolved here rather than by the listener:
	// on a two-person thread, forgetting to skip them means notifying somebody
	// about their own message.
	const readers = await listGroupChatReaders(params.groupId);
	domainEvents.emit('inbox.group_message', {
		threadId,
		messageId: message.id,
		groupId: params.groupId,
		groupName: params.groupName,
		senderId: params.userId,
		senderName: params.userName,
		recipientIds: readers.filter((r) => r.id !== params.userId).map((r) => r.id)
	});

	return { messageId: message.id };
}

/** Move this reader's cursor to now, in one topic. */
export async function markGroupChatRead(threadId: string, userId: string): Promise<void> {
	await db
		.insert(inboxGroupRead)
		.values({ threadId, userId, lastReadAt: new Date() })
		.onConflictDoUpdate({
			target: [inboxGroupRead.threadId, inboxGroupRead.userId],
			set: { lastReadAt: new Date() }
		});
}

/**
 * How many of a group's topics this reader has unread.
 *
 * A count of topics, not of messages: the badge answers "how many rooms want
 * you", which is the number you can act on one at a time. Before topics this
 * was structurally 0 or 1 and read as a dot.
 */
export async function countGroupChatUnread(groupId: string, userId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(inboxThread)
		.leftJoin(
			inboxGroupRead,
			and(eq(inboxGroupRead.threadId, inboxThread.id), eq(inboxGroupRead.userId, userId))
		)
		.where(
			and(
				topicsOf(groupId),
				// An empty topic is not unread — see `listGroupTopics`.
				isNotNull(inboxThread.lastMessageAt),
				or(
					isNull(inboxGroupRead.lastReadAt),
					gt(inboxThread.lastMessageAt, inboxGroupRead.lastReadAt)
				)
			)
		);
	return row?.count ?? 0;
}

/**
 * The group a chat thread belongs to, for a guard that starts from the thread.
 *
 * Returns null for anything that is not a group chat, which keeps this from
 * becoming a way into an enquiry.
 */
export async function groupOfChatThread(
	threadId: string
): Promise<{ id: string; slug: string } | null> {
	const [row] = await db
		.select({ id: group.id, slug: group.slug })
		.from(inboxThread)
		.innerJoin(group, eq(group.id, inboxThread.groupId))
		.where(and(eq(inboxThread.id, threadId), eq(inboxThread.channel, 'group')))
		.limit(1);
	return row ?? null;
}

/** Who is in the room, for the header. */
export async function listGroupChatReaders(groupId: string) {
	const { groupMember } = await import('$lib/server/db/schema/group');
	return db
		.select({ id: user.id, name: user.name })
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.status, 'active')));
}
