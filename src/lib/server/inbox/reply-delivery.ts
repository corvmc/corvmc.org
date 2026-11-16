import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { inboxMessage, inboxThread } from '#lib/server/db/schema/inbox.js';
import { dispatchReply } from './channel-dispatcher';

/**
 * The outbox's transport for `inbox_reply` rows, and the only caller of
 * `dispatchReply`: a reply is filed with its outbox row and sent from here, so
 * a refused send is recorded and retried. scripts/mail-outbox-guard.spec.ts
 * refuses any other import of it.
 */

type Thread = typeof inboxThread.$inferSelect;

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

/** Everything the channel needs to send `body` as a reply on `thread`. */
async function replyParams(thread: Thread, body: string, staffName: string) {
	// The last inbound message does two jobs: its id threads the email reply, and
	// its timestamp is what tells the Meta channels whether the 24-hour messaging
	// window is still open.
	const [lastInbound] = await db
		.select({ channelMessageId: inboxMessage.channelMessageId, createdAt: inboxMessage.createdAt })
		.from(inboxMessage)
		.where(and(eq(inboxMessage.threadId, thread.id), eq(inboxMessage.direction, 'inbound')))
		.orderBy(desc(inboxMessage.createdAt), desc(inboxMessage.id))
		.limit(1);

	// Build References chain from all inbound message IDs
	const inboundIds = await db
		.select({ channelMessageId: inboxMessage.channelMessageId })
		.from(inboxMessage)
		.where(and(eq(inboxMessage.threadId, thread.id), eq(inboxMessage.direction, 'inbound')))
		.orderBy(inboxMessage.createdAt, asc(inboxMessage.id));

	const references =
		inboundIds
			.map((m) => normalizeMessageId(m.channelMessageId))
			.filter(Boolean)
			.join(' ') || null;

	return {
		channel: thread.channel,
		threadId: thread.id,
		groupId: thread.groupId,
		body,
		staffName,
		contactName: thread.contactName,
		contactEmail: thread.contactEmail,
		contactPhone: thread.contactPhone,
		contactExternalId: thread.contactExternalId,
		subject: thread.subject,
		lastInboundMessageId: normalizeMessageId(lastInbound?.channelMessageId),
		lastInboundAt: lastInbound?.createdAt ?? null,
		references
	};
}

/**
 * The outbox's sender for a queued reply: dispatch on the thread's channel and
 * stamp the channel's id on the message. Throws when the channel refuses.
 */
export async function deliverQueuedReply(messageId: string): Promise<string | null> {
	const [row] = await db
		.select({ message: inboxMessage, thread: inboxThread })
		.from(inboxMessage)
		.innerJoin(inboxThread, eq(inboxThread.id, inboxMessage.threadId))
		.where(eq(inboxMessage.id, messageId))
		.limit(1);
	if (!row) throw new Error(`Message ${messageId} not found`);

	const channelMessageId =
		(await dispatchReply(
			await replyParams(row.thread, row.message.body, row.message.authorName ?? '')
		)) ?? null;
	if (channelMessageId) {
		await db.update(inboxMessage).set({ channelMessageId }).where(eq(inboxMessage.id, messageId));
	}
	return channelMessageId;
}
