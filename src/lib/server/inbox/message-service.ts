import { db } from '$lib/server/db';
import { inboxThread, inboxMessage, inboxNote } from '$lib/server/db/schema/inbox';
import { eq, sql, desc, and } from 'drizzle-orm';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { truncatePreview } from './thread-service';
import { dispatchReply } from './channel-dispatcher';

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
async function touchThread(threadId: string, body: string): Promise<void> {
	await db
		.update(inboxThread)
		.set({
			preview: truncatePreview(body),
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

	await touchThread(params.threadId, params.body);

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

	await touchThread(params.threadId, params.body);

	const [thread] = await db
		.select({ channel: inboxThread.channel, contactName: inboxThread.contactName })
		.from(inboxThread)
		.where(eq(inboxThread.id, params.threadId))
		.limit(1);

	domainEvents.emit('inbox.message_received', {
		threadId: params.threadId,
		messageId: message.id,
		channel: thread.channel,
		contactName: thread.contactName,
		preview: truncatePreview(params.body)
	});

	return message;
}

/**
 * In-Reply-To / References must hold RFC 5322 msg-ids. Older rows (and every
 * outbound row) store Postmark's internal GUID instead, which no mail client
 * can thread on — drop those rather than emit a malformed header. Thread
 * routing does not depend on this; the signed Reply-To address does that.
 */
function normalizeMessageId(raw: string | null | undefined): string | null {
	const value = raw?.trim();
	if (!value || !value.includes('@')) return null;
	return value.startsWith('<') && value.endsWith('>') ? value : `<${value}>`;
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
		.set({
			preview: truncatePreview(params.body),
			messageCount: sql`${inboxThread.messageCount} + 1`,
			lastMessageAt: new Date(),
			// Only ever set here. A thread with this null has never been answered,
			// which is how the queue tells "unanswered" from "they replied".
			lastOutboundAt: new Date(),
			// We have said our piece, so the thread is now waiting on them. Read off
			// the row already selected above rather than a second query. A reply sent
			// after resolving leaves no marker — the badge only means something on a
			// thread that is still open.
			awaitingReplySince: thread.status === 'resolved' ? null : new Date(),
			updatedAt: new Date()
		})
		.where(eq(inboxThread.id, params.threadId));

	// Only for a reply a staff member actually typed here. The lone listener
	// notifies on `portal` alone — where the message row is the delivery — and an
	// echo is never portal, so an event carrying a null sender would be a payload
	// nothing reads and every future listener has to remember to guard.
	if (params.authorUserId) {
		domainEvents.emit('inbox.message_sent', {
			threadId: params.threadId,
			messageId: message.id,
			channel: thread.channel,
			sentByUserId: params.authorUserId
		});
	}

	return message;
}

export async function addOutboundMessage(params: AddOutboundMessageParams) {
	const [thread] = await db
		.select()
		.from(inboxThread)
		.where(eq(inboxThread.id, params.threadId))
		.limit(1);

	if (!thread) throw new Error(`Thread ${params.threadId} not found`);

	// The last inbound message does two jobs: its id threads the email reply, and
	// its timestamp is what tells the Meta channels whether the 24-hour messaging
	// window is still open.
	const [lastInbound] = await db
		.select({ channelMessageId: inboxMessage.channelMessageId, createdAt: inboxMessage.createdAt })
		.from(inboxMessage)
		.where(and(eq(inboxMessage.threadId, params.threadId), eq(inboxMessage.direction, 'inbound')))
		.orderBy(desc(inboxMessage.createdAt))
		.limit(1);

	// Build References chain from all inbound message IDs
	const inboundIds = await db
		.select({ channelMessageId: inboxMessage.channelMessageId })
		.from(inboxMessage)
		.where(and(eq(inboxMessage.threadId, params.threadId), eq(inboxMessage.direction, 'inbound')))
		.orderBy(inboxMessage.createdAt);

	const references =
		inboundIds
			.map((m) => normalizeMessageId(m.channelMessageId))
			.filter(Boolean)
			.join(' ') || null;

	let channelMessageId: string | null;

	try {
		channelMessageId =
			(await dispatchReply({
				channel: thread.channel,
				threadId: thread.id,
				body: params.body,
				staffName: params.authorName,
				contactName: thread.contactName,
				contactEmail: thread.contactEmail,
				contactPhone: thread.contactPhone,
				contactExternalId: thread.contactExternalId,
				subject: thread.subject,
				lastInboundMessageId: normalizeMessageId(lastInbound?.channelMessageId),
				lastInboundAt: lastInbound?.createdAt ?? null,
				references
			})) ?? null;
	} catch (err) {
		console.error('[inbox] Failed to dispatch reply:', err);
		throw err;
	}

	return recordOutboundMessage({
		threadId: params.threadId,
		body: params.body,
		authorName: params.authorName,
		authorUserId: params.authorUserId,
		channelMessageId,
		thread
	});
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
