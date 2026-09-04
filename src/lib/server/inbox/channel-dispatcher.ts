import { env } from '$env/dynamic/private';
import { sendInboxReply } from '$lib/server/notification/email/postmark-client';
import { sendSms } from './twilio-client';
import { sendMetaMessage } from './meta-client';
import { isChannelEnabled } from './channel-config-service';
import { buildReplyToAddress } from './reply-address';
import type { InboxChannel } from '$lib/server/db/schema/inbox';

export interface DispatchReplyParams {
	channel: InboxChannel;
	threadId: string;
	body: string;
	staffName: string;
	contactName: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
	contactExternalId: string | null;
	subject: string | null;
	/** Last inbound channelMessageId for email threading */
	lastInboundMessageId: string | null;
	/**
	 * When the contact last wrote. Email and SMS ignore it; the Meta channels
	 * cannot send at all outside a window measured from exactly this.
	 */
	lastInboundAt: Date | null;
	/** Accumulated References chain */
	references: string | null;
}

export async function dispatchReply(params: DispatchReplyParams): Promise<string | null> {
	const enabled = await isChannelEnabled(params.channel);
	if (!enabled) {
		throw new Error(
			`Channel "${params.channel}" is not enabled. Enable it in Settings → Inbox Channels.`
		);
	}

	switch (params.channel) {
		// Contact-form ('web') threads reply by email too: the submitter gave us
		// their address, and the Reply-To below routes their response back into
		// this same thread. Deliberately not gated on the 'email' channel toggle
		// — that governs the inbound support mailbox, not outbound replies.
		case 'email':
		case 'web':
			return dispatchEmailReply(params);
		// Nothing to send: the message row this returns to IS the delivery. The
		// member reads it in /member/messages, and the inbox.message_sent
		// listener notifies them.
		case 'portal':
			return null;
		// Unreachable, and meant to stay that way. Staff never write into a
		// member↔member conversation — there is no reply path from the inbox to
		// a direct thread, because direct threads are not in the inbox. Throwing
		// rather than returning null so that a future caller that gets here is
		// loud about it instead of silently dropping a message.
		case 'direct':
			throw new Error(
				'Direct threads have no reply path: staff do not write into member conversations.'
			);
		case 'sms':
			return dispatchSmsReply(params);
		case 'instagram':
		case 'messenger':
			return dispatchMetaReply(params);
	}
}

async function dispatchSmsReply(params: DispatchReplyParams): Promise<string> {
	if (!params.contactPhone) {
		throw new Error('Cannot send SMS reply: no contact phone on thread');
	}

	const sid = await sendSms(params.contactPhone, params.body);
	return sid;
}

async function dispatchEmailReply(params: DispatchReplyParams): Promise<string> {
	if (!params.contactEmail) {
		throw new Error('Cannot send email reply: no contact email on thread');
	}

	const subject = params.subject
		? params.subject.startsWith('Re:')
			? params.subject
			: `Re: ${params.subject}`
		: 'Re: Your message to CorvMC';

	// Falls back to the staff mailbox when no inbound reply address is
	// configured, so a response still reaches a human rather than noreply@.
	const replyTo = buildReplyToAddress(params.threadId) ?? env.STAFF_CONTACT_EMAIL ?? null;

	const messageId = await sendInboxReply({
		to: params.contactEmail,
		// The template is text-only, so there is no preheader to fill — the mail
		// client's snippet is just the opening of the body.
		model: {
			subject,
			contactName: params.contactName ?? 'there',
			staffName: params.staffName,
			body: params.body
		},
		replyTo,
		inReplyTo: params.lastInboundMessageId,
		references: params.references,
		metadata: { threadId: params.threadId }
	});

	return messageId;
}

async function dispatchMetaReply(params: DispatchReplyParams): Promise<string> {
	if (!params.contactExternalId) {
		throw new Error('Cannot send Meta reply: no contact external ID on thread');
	}

	return sendMetaMessage({
		recipientId: params.contactExternalId,
		body: params.body,
		lastInboundAt: params.lastInboundAt
	});
}
