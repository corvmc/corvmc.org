import { db } from '$lib/server/db';
import { inboxThread, inboxMessage, inboxNote } from '$lib/server/db/schema/inbox';
import { eq, sql, desc, and } from 'drizzle-orm';
import { domainEvents } from '$lib/server/events/event-bus';
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

export async function addOutboundMessage(params: AddOutboundMessageParams) {
	const [thread] = await db
		.select()
		.from(inboxThread)
		.where(eq(inboxThread.id, params.threadId))
		.limit(1);

	if (!thread) throw new Error(`Thread ${params.threadId} not found`);

	// Find last inbound message ID for email threading
	const [lastInbound] = await db
		.select({ channelMessageId: inboxMessage.channelMessageId })
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
				references
			})) ?? null;
	} catch (err) {
		console.error('[inbox] Failed to dispatch reply:', err);
		throw err;
	}

	const [message] = await db
		.insert(inboxMessage)
		.values({
			threadId: params.threadId,
			direction: 'outbound',
			body: params.body,
			authorName: params.authorName,
			authorUserId: params.authorUserId,
			channelMessageId
		})
		.returning();

	await db
		.update(inboxThread)
		.set({
			preview: truncatePreview(params.body),
			messageCount: sql`${inboxThread.messageCount} + 1`,
			lastMessageAt: new Date(),
			// We have said our piece, so the thread is now waiting on them. Read off
			// the row already selected above rather than a second query. A reply sent
			// after resolving leaves no marker — the badge only means something on a
			// thread that is still open.
			awaitingReplySince: thread.status === 'resolved' ? null : new Date(),
			updatedAt: new Date()
		})
		.where(eq(inboxThread.id, params.threadId));

	domainEvents.emit('inbox.message_sent', {
		threadId: params.threadId,
		messageId: message.id,
		channel: thread.channel,
		sentByUserId: params.authorUserId
	});

	return message;
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
