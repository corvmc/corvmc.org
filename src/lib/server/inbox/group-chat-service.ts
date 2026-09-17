import { and, asc, count, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { inboxThread, inboxMessage, inboxGroupRead } from '$lib/server/db/schema/inbox';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
import { touchThread } from './message-service';

/**
 * The one thread a group's members share — the band-enquiry shape with the
 * door widened from owner|admin to any active member (#1252).
 *
 * Readership is the roster, resolved live. `channel: 'group'`, never `'band'`:
 * that one means a stranger used the booking form. **Nothing here gates** —
 * the caller does, with `requireGroupRole(ref, 'member')`.
 */

/** The group's chat thread, creating it on first use. */
export async function getOrCreateGroupChat(groupId: string): Promise<string> {
	const [existing] = await db
		.select({ id: inboxThread.id })
		.from(inboxThread)
		.where(and(eq(inboxThread.channel, 'group'), eq(inboxThread.groupId, groupId)))
		.limit(1);
	if (existing) return existing.id;

	const [created] = await db
		.insert(inboxThread)
		.values({ channel: 'group', groupId, status: 'open' })
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
export async function getGroupChat(groupId: string) {
	const threadId = await getOrCreateGroupChat(groupId);

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
		.where(eq(inboxMessage.threadId, threadId))
		.orderBy(asc(inboxMessage.createdAt));

	const [g] = await db
		.select({ name: group.name })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);

	return {
		id: threadId,
		groupName: g?.name ?? 'This group',
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
	userId: string;
	userName: string;
	body: string;
}): Promise<{ messageId: string }> {
	const threadId = await getOrCreateGroupChat(params.groupId);

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
	await markGroupChatRead(params.groupId, params.userId);

	return { messageId: message.id };
}

/** Move this reader's cursor to now. */
export async function markGroupChatRead(groupId: string, userId: string): Promise<void> {
	const threadId = await getOrCreateGroupChat(groupId);

	await db
		.insert(inboxGroupRead)
		.values({ threadId, userId, lastReadAt: new Date() })
		.onConflictDoUpdate({
			target: [inboxGroupRead.threadId, inboxGroupRead.userId],
			set: { lastReadAt: new Date() }
		});
}

/**
 * Whether this reader has unread chat in one group.
 *
 * A count of threads, not of messages — there is only ever one — so this is 0
 * or 1 and reads as a dot rather than a number.
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
				eq(inboxThread.channel, 'group'),
				eq(inboxThread.groupId, groupId),
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
