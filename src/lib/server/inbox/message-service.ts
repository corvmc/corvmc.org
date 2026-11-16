import { db } from '#lib/server/db/index.js';
import { inboxThread, inboxMessage, inboxNote } from '#lib/server/db/schema/inbox.js';
import { eq, sql, and } from 'drizzle-orm';
import { replyDeliveries } from './reply-status';
import { domainEvents } from '#lib/server/event-bus/event-bus.js';
import { messagePreview } from './thread-service';
import type { InboxChannel } from '#lib/server/db/schema/inbox.js';
import { outboxMessage } from '#lib/server/db/schema/outbox.js';
import { outboxRow, type OutboxSubject } from '#lib/server/outbox/outbox-row.js';
import { deliverNow, retryNow, type Delivery } from '#lib/server/outbox/outbox-service.js';

export interface AddInboundMessageParams {
	threadId: string;
	body: string;
	bodyHtml?: string | null;
	authorName?: string | null;
	channelMessageId?: string | null;
	channelMetadata?: unknown;
	/** Set when the sender has an account, i.e. portal threads. */
	authorUserId?: string | null;
}

/**
 * Thread bookkeeping every new message performs: refresh the preview, bump the
 * count, move the clock. Shared so a second kind of message cannot drift from
 * the first — a thread whose lastMessageAt does not move is a thread whose
 * unread cursor silently stops working.
 *
 * Clearing `awaitingReplySince` belongs here rather than in `addInboundMessage`:
 * every channel's inbound path funnels through this one update, so the marker
 * cannot survive an answer on a channel someone forgot about. Peer messages
 * clear a column that direct threads never set, which costs nothing.
 */
// Exported for `group-chat-service.ts`, whose insert cannot go through
// `addPeerMessage` — that one emits a DM event naming a single recipient.
export async function touchThread(
	threadId: string,
	body: string,
	channel: InboxChannel
): Promise<void> {
	await db
		.update(inboxThread)
		.set({
			preview: messagePreview(body, channel),
			messageCount: sql`${inboxThread.messageCount} + 1`,
			lastMessageAt: new Date(),
			awaitingReplySince: null,
			updatedAt: new Date()
		})
		.where(eq(inboxThread.id, threadId));
}

export interface AddPeerMessageParams {
	threadId: string;
	body: string;
	authorUserId: string;
	authorName: string;
	recipientUserId: string;
	/** True while the recipient has not accepted yet. */
	isRequest: boolean;
}

/**
 * A message from one member to another.
 *
 * Separate from `addInboundMessage` for two reasons that both matter:
 *
 *  - It writes `direction: 'peer'`. A DM is not inbound — nobody wrote to
 *    CorvMC — and `addOutboundMessage` below builds its email References chain
 *    by querying `direction = 'inbound'`. Filing DMs as inbound would quietly
 *    put private messages in that chain.
 *  - It emits `inbox.direct_message`, never `inbox.message_received`. That
 *    event notifies every staff member and carries the preview text, which for
 *    a DM is a member's private words.
 *
 * The event names the recipient outright rather than leaving a listener to fan
 * out over participants and remember to skip the author — with two people on a
 * thread, that mistake means notifying someone about their own message.
 */
export async function addPeerMessage(params: AddPeerMessageParams) {
	const [message] = await db
		.insert(inboxMessage)
		.values({
			threadId: params.threadId,
			direction: 'peer',
			body: params.body,
			authorName: params.authorName,
			authorUserId: params.authorUserId
		})
		.returning();

	await touchThread(params.threadId, params.body, 'direct');

	domainEvents.emit('inbox.direct_message', {
		threadId: params.threadId,
		messageId: message.id,
		senderId: params.authorUserId,
		senderName: params.authorName,
		recipientId: params.recipientUserId,
		isRequest: params.isRequest
	});

	return message;
}

/**
 * The message already filed under this channel's external id, if any.
 *
 * Meta redelivers a webhook for up to 36 hours after a non-200, and delivers an
 * echo of every message the Page sends — including the ones we sent ourselves,
 * carrying the very `mid` we stored on dispatch. Both arrive as an ordinary
 * event, so the only thing separating "they wrote again" from "we have seen
 * this" is the id. Reads the `idx_inbox_message_channel_id` index.
 *
 * Not applied to email or SMS: Postmark and Twilio do not redeliver on a 200,
 * and both of those paths were built before this existed.
 */
export async function findMessageByChannelId(channelMessageId: string) {
	const [message] = await db
		.select()
		.from(inboxMessage)
		.where(eq(inboxMessage.channelMessageId, channelMessageId))
		.limit(1);

	return message;
}

export async function addInboundMessage(params: AddInboundMessageParams) {
	const [message] = await db
		.insert(inboxMessage)
		.values({
			threadId: params.threadId,
			direction: 'inbound',
			body: params.body,
			bodyHtml: params.bodyHtml ?? null,
			authorName: params.authorName ?? null,
			authorUserId: params.authorUserId ?? null,
			channelMessageId: params.channelMessageId ?? null,
			channelMetadata: params.channelMetadata ?? null
		})
		.returning();

	const [thread] = await db
		.select({ channel: inboxThread.channel, contactName: inboxThread.contactName })
		.from(inboxThread)
		.where(eq(inboxThread.id, params.threadId))
		.limit(1);

	await touchThread(params.threadId, params.body, thread.channel);

	domainEvents.emit('inbox.message_received', {
		threadId: params.threadId,
		messageId: message.id,
		channel: thread.channel,
		contactName: thread.contactName,
		preview: messagePreview(params.body, thread.channel)
	});

	return message;
}

export interface AddOutboundMessageParams {
	threadId: string;
	body: string;
	authorUserId: string;
	authorName: string;
}

export interface RecordOutboundMessageParams {
	threadId: string;
	body: string;
	authorName: string;
	/**
	 * Null when nobody here typed it: a reply staff sent from the Instagram or
	 * Messenger app, which reaches us as an echo. The message is ours, the
	 * account behind it is not one of ours.
	 */
	authorUserId: string | null;
	channelMessageId: string | null;
	/** The thread row, when the caller has already selected it. */
	thread?: typeof inboxThread.$inferSelect;
}

/**
 * File a reply that has already been delivered.
 *
 * The half of `addOutboundMessage` that runs after dispatch, extracted because
 * an echo is a message Meta has *already sent* — routing it back through
 * `addOutboundMessage` would deliver it a second time. The `lastOutboundAt` and
 * `awaitingReplySince` rules documented on the schema are subtle enough that a
 * second copy of them in the Meta handler would drift; this way there is one.
 */
export async function recordOutboundMessage(params: RecordOutboundMessageParams) {
	let thread = params.thread;
	if (!thread) {
		[thread] = await db
			.select()
			.from(inboxThread)
			.where(eq(inboxThread.id, params.threadId))
			.limit(1);
	}

	if (!thread) throw new Error(`Thread ${params.threadId} not found`);

	const [message] = await db
		.insert(inboxMessage)
		.values({
			threadId: params.threadId,
			direction: 'outbound',
			body: params.body,
			authorName: params.authorName,
			authorUserId: params.authorUserId,
			channelMessageId: params.channelMessageId
		})
		.returning();

	await db
		.update(inboxThread)
		.set(threadAfterOutbound(thread, params.body))
		.where(eq(inboxThread.id, params.threadId));

	announceOutbound(thread, message.id, params.authorUserId);
	return message;
}

type Thread = typeof inboxThread.$inferSelect;

/** What an outbound message does to its thread, sent now or queued. */
function threadAfterOutbound(thread: Thread, body: string) {
	return {
		preview: messagePreview(body, thread.channel),
		messageCount: sql`${inboxThread.messageCount} + 1`,
		lastMessageAt: new Date(),
		// Only ever set here. A thread with this null has never been answered,
		// which is how the queue tells "unanswered" from "they replied".
		lastOutboundAt: new Date(),
		// We have said our piece, so the thread is now waiting on them. A reply
		// sent after resolving leaves no marker — the badge only means something
		// on a thread that is still open.
		awaitingReplySince: thread.status === 'resolved' ? null : new Date(),
		updatedAt: new Date()
	};
}

/**
 * Only for a reply a staff member typed here. The lone listener notifies on
 * `portal`, where the message row is the delivery; an echo has no sender.
 */
function announceOutbound(thread: Thread, messageId: string, authorUserId: string | null) {
	if (!authorUserId) return;
	domainEvents.emit('inbox.message_sent', {
		threadId: thread.id,
		messageId,
		channel: thread.channel,
		sentByUserId: authorUserId
	});
}

/** The outbox row a reply was filed with, keyed by the message. */
const replySubject = (messageId: string): OutboxSubject => ({
	type: 'inbox_message',
	id: messageId
});

/**
 * A reply filed now and sent by the outbox: the statements to put in the
 * caller's `db.batch` beside the change that owes the reply, so the two commit
 * together. Call `announceQueuedReply` once the batch has committed.
 */
export async function queuedReplyStatements(
	params: AddOutboundMessageParams & { subject?: OutboxSubject }
) {
	const [thread] = await db
		.select()
		.from(inboxThread)
		.where(eq(inboxThread.id, params.threadId))
		.limit(1);
	if (!thread) throw new Error(`Thread ${params.threadId} not found`);

	const messageId = crypto.randomUUID();
	const outbox = outboxRow(
		{ kind: 'inbox_reply', payload: { messageId } },
		params.subject ?? replySubject(messageId)
	);
	return {
		thread,
		messageId,
		outboxId: outbox.id,
		statements: [
			db.insert(inboxMessage).values({
				id: messageId,
				threadId: thread.id,
				direction: 'outbound',
				body: params.body,
				authorName: params.authorName,
				authorUserId: params.authorUserId,
				channelMessageId: null
			}),
			db
				.update(inboxThread)
				.set(threadAfterOutbound(thread, params.body))
				.where(eq(inboxThread.id, thread.id)),
			db.insert(outboxMessage).values(outbox)
		] as const
	};
}

export function announceQueuedReply(
	queued: { thread: Thread; messageId: string },
	authorUserId: string
) {
	announceOutbound(queued.thread, queued.messageId, authorUserId);
}

/**
 * A reply typed here: filed with its outbox row in one batch, then sent at
 * once so the author sees how it went. A refused send leaves the message on
 * the thread with its outbox row pending, which the cron retries and
 * `retryReply` sends again.
 */
export async function addOutboundMessage(
	params: AddOutboundMessageParams
): Promise<{ id: string; delivery: Delivery }> {
	const queued = await queuedReplyStatements(params);
	await db.batch([...queued.statements]);
	announceQueuedReply(queued, params.authorUserId);
	return { id: queued.messageId, delivery: await deliverNow(queued.outboxId) };
}

/**
 * Send a reply on `threadId` that has not gone, now. Null when there is none
 * to send: it went, it is not on that thread, or a sender holds it.
 */
export async function retryReply(threadId: string, messageId: string): Promise<Delivery | null> {
	const [message] = await db
		.select({ id: inboxMessage.id })
		.from(inboxMessage)
		.where(
			and(
				eq(inboxMessage.id, messageId),
				eq(inboxMessage.threadId, threadId),
				eq(inboxMessage.direction, 'outbound')
			)
		)
		.limit(1);
	if (!message) return null;
	const latest = (await replyDeliveries([messageId])).get(messageId);
	if (!latest || latest.status === 'sent') return null;
	return retryNow(latest.outboxId);
}

export async function addNote(params: { threadId: string; authorUserId: string; body: string }) {
	const [note] = await db
		.insert(inboxNote)
		.values({
			threadId: params.threadId,
			authorUserId: params.authorUserId,
			body: params.body
		})
		.returning();

	return note;
}
