import {
	findOrCreateThread,
	findThreadById,
	reopenThread,
	setThreadContactName
} from './thread-service';
import {
	addInboundMessage,
	addOutboundMessage,
	addNote,
	findMessageByChannelId,
	recordOutboundMessage
} from './message-service';
import { fetchMetaProfile, type MetaAttachment, type MetaMessage } from './meta-client';
import { parseReplyMailboxHash } from './reply-address';
import { isChannelEnabled } from './channel-config-service';
import { findStaffUserByEmail } from '$lib/server/authorization';
import { captureException } from '$lib/server/sentry';
import { domainEvents } from '$lib/server/event-bus/event-bus';

export interface ContactFormParams {
	name: string;
	email: string;
	subject: string;
	message: string;
	/** Event-tip fields. All optional — a tip is a lead, not a record. */
	tipEventName?: string;
	tipEventDate?: string;
	tipVenue?: string;
	tipLink?: string;
}

/**
 * Fold the event-tip fields into the message body.
 *
 * A tip stays an ordinary web thread rather than growing its own table and its
 * own queue: the inbox exists so staff have one place to look, and a second
 * triage surface is a second thing to forget. Prepended rather than appended so
 * the details are the first thing a staffer reads.
 */
function withTipDetails(params: ContactFormParams): string {
	const details = [
		['Event', params.tipEventName],
		['Date', params.tipEventDate],
		['Venue', params.tipVenue],
		['Link', params.tipLink]
	].filter(([, value]) => value && value.trim());

	if (details.length === 0) return params.message;

	const block = details.map(([label, value]) => `${label}: ${value!.trim()}`).join('\n');
	return `${block}\n\n---\n\n${params.message}`;
}

export async function handleContactForm(params: ContactFormParams) {
	const thread = await findOrCreateThread({
		channel: 'web',
		contactName: params.name,
		contactEmail: params.email,
		subject: params.subject
	});

	const body = withTipDetails(params);

	const message = await addInboundMessage({
		threadId: thread.id,
		body,
		authorName: params.name
	});

	domainEvents.emit('contact.form_submitted', {
		threadId: thread.id,
		name: params.name,
		email: params.email,
		subject: params.subject,
		message: body
	});

	return { thread, message };
}

export interface PostmarkInboundPayload {
	From: string;
	FromName: string;
	FromFull: { Email: string; Name: string };
	To: string;
	Subject: string;
	TextBody: string;
	HtmlBody: string;
	StrippedTextReply: string;
	MessageID: string;
	Date: string;
	Headers: Array<{ Name: string; Value: string }>;
	Attachments: Array<{ Name: string; Content: string; ContentType: string; ContentLength: number }>;
	/** Part after the `+` in the recipient address — carries our signed thread id */
	MailboxHash?: string;
	OriginalRecipient?: string;
	ToFull?: Array<{ Email: string; Name: string; MailboxHash: string }>;
}

/** Pull the sender's real RFC 5322 Message-ID out of the raw headers. Postmark's
 *  own `MessageID` is an internal GUID, not a msg-id, so it can't be threaded on. */
function extractMessageIdHeader(headers: PostmarkInboundPayload['Headers']): string | null {
	const header = headers?.find((h) => h.Name?.toLowerCase() === 'message-id');
	const value = header?.Value?.trim();
	return value && value.includes('@') ? value : null;
}

function headerValue(headers: PostmarkInboundPayload['Headers'], name: string): string | null {
	const header = headers?.find((h) => h.Name?.toLowerCase() === name.toLowerCase());
	return header?.Value?.trim().toLowerCase() ?? null;
}

/**
 * Machine-generated mail: vacation responders, bounce notices, ticket robots.
 * Worth detecting only on the relay path — a staff out-of-office would
 * otherwise be forwarded to the contact and logged as a considered reply.
 */
function isAutoResponse(headers: PostmarkInboundPayload['Headers']): boolean {
	const autoSubmitted = headerValue(headers, 'Auto-Submitted');
	if (autoSubmitted && autoSubmitted !== 'no') return true;
	if (headerValue(headers, 'X-Autoreply')) return true;
	const precedence = headerValue(headers, 'Precedence');
	return precedence === 'bulk' || precedence === 'auto_reply';
}

/**
 * Cut a reply at the start of the text it quotes.
 *
 * Postmark's `StrippedTextReply` does this for us and is preferred, but it comes
 * back empty for some clients and for bottom-posted replies. On the relay path
 * the quoted text is the staff alert itself — carrying the inbox URL and the
 * internal reply note — so shipping it to a member of the public is worse than
 * over-trimming.
 */
function stripQuotedReply(text: string): string {
	const lines = text.split('\n');
	const cut = lines.findIndex(
		(line) =>
			/^\s*>/.test(line) ||
			/^\s*On .+ wrote:\s*$/.test(line) ||
			/^--- (message|end of message) ---\s*$/.test(line)
	);
	return (cut === -1 ? lines : lines.slice(0, cut)).join('\n').trim();
}

/** Same mailbox, ignoring the case no mail client normalises. */
function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function handlePostmarkInbound(payload: PostmarkInboundPayload) {
	const fromEmail = payload.FromFull?.Email ?? payload.From;
	const fromName = payload.FromName || fromEmail;
	const body = payload.StrippedTextReply || payload.TextBody || '';
	const subject = payload.Subject || null;

	const rawHash = payload.MailboxHash || payload.ToFull?.[0]?.MailboxHash || null;
	const hashedThreadId = parseReplyMailboxHash(rawHash);

	// A reply to a thread we started: route it straight back, whatever the
	// thread's channel. A contact-form thread stays 'web' — that provenance is
	// what the staff UI shows, and re-labelling it 'email' would let unrelated
	// mail from the same address start merging into it.
	if (hashedThreadId) {
		const thread = await findThreadById(hashedThreadId);

		// Never into a member↔member conversation. Routing below is deliberately
		// channel-agnostic — see the comment above — and that is right for every
		// channel the org actually corresponds on. A direct thread is not one of
		// them: nothing we send carries a reply address for it, so anything
		// arriving here with one is either misrouted or forged. Filing it would
		// write a message into a private conversation with a null authorUserId,
		// which renders as "not yours" to *both* participants.
		if (thread?.channel === 'direct') return { thread: null, message: null };

		if (thread) {
			if (thread.status === 'resolved') {
				await reopenThread(thread.id);
			}

			// Staff answer the contact-form alert straight from their mail client.
			// Their reply arrives here looking like any other inbound message, but
			// filing it as one would attribute their words to the contact and never
			// deliver them — so relay it instead.
			//
			// A staffer who is themselves the thread contact is skipped: relaying
			// would mail them their own words, and their reply to that would relay
			// again. A sender we don't recognise as staff keeps the existing inbound
			// behaviour — that covers a contact forwarding our reply to a colleague
			// who answers. Note the signed address now circulates in staff mailboxes,
			// so anyone an alert is forwarded to can write into the thread.
			const staffSender = sameAddress(fromEmail, thread.contactEmail)
				? null
				: await findStaffUserByEmail(fromEmail);

			if (staffSender && !isAutoResponse(payload.Headers)) {
				return relayStaffReply({
					threadId: thread.id,
					thread,
					staff: staffSender,
					body: payload.StrippedTextReply?.trim() || stripQuotedReply(payload.TextBody || ''),
					fromEmail
				});
			}

			const message = await addInboundMessage({
				threadId: thread.id,
				body,
				bodyHtml: payload.HtmlBody || null,
				authorName: fromName,
				channelMessageId: extractMessageIdHeader(payload.Headers) ?? payload.MessageID ?? null,
				channelMetadata: {
					headers: payload.Headers,
					attachmentCount: payload.Attachments?.length ?? 0,
					date: payload.Date,
					postmarkMessageId: payload.MessageID,
					// The reply may have been forwarded — record who actually sent it,
					// but leave thread.contactEmail alone so staff replies keep going
					// to the original contact.
					fromEmail
				}
			});

			return { thread, message };
		}
	}

	// No usable hash: unsolicited mail to the support address. Only accepted
	// when the email channel is switched on.
	if (!(await isChannelEnabled('email'))) {
		return { thread: null, message: null };
	}

	const thread = await findOrCreateThread({
		channel: 'email',
		contactName: fromName,
		contactEmail: fromEmail,
		subject
	});

	const message = await addInboundMessage({
		threadId: thread.id,
		body,
		bodyHtml: payload.HtmlBody || null,
		authorName: fromName,
		channelMessageId: extractMessageIdHeader(payload.Headers) ?? payload.MessageID ?? null,
		channelMetadata: {
			headers: payload.Headers,
			attachmentCount: payload.Attachments?.length ?? 0,
			date: payload.Date,
			postmarkMessageId: payload.MessageID,
			// Present but unusable — surfaced so a routing failure is diagnosable
			// from the message record rather than silently creating a new thread.
			...(rawHash && !hashedThreadId ? { unresolvedMailboxHash: rawHash } : {})
		}
	});

	return { thread, message };
}

export interface TwilioInboundParams {
	From: string;
	To: string;
	Body: string;
	MessageSid: string;
	NumMedia?: string;
}

export async function handleTwilioInbound(params: TwilioInboundParams) {
	const phone = params.From;
	const body = params.Body || '';

	const thread = await findOrCreateThread({
		channel: 'sms',
		contactPhone: phone
	});

	const message = await addInboundMessage({
		threadId: thread.id,
		body,
		channelMessageId: params.MessageSid,
		channelMetadata: {
			to: params.To,
			numMedia: params.NumMedia ?? '0'
		}
	});

	return { thread, message };
}

export interface MetaInboundParams {
	channel: 'instagram' | 'messenger';
	senderId: string;
	messageId: string;
	/** Already rendered by `metaMessageBody` — placeholder text for a message
	 *  that carried only a photo, a shared reel or a story reply. */
	body: string;
	timestamp: number;
	attachments?: MetaAttachment[] | null;
	replyTo?: MetaMessage['reply_to'] | null;
}

/**
 * A message from a contact on Instagram or Messenger.
 *
 * The dedupe is not optional here the way it would be for Postmark: Meta
 * redelivers a webhook for up to 36 hours after any non-200, and this route
 * answers 200 only after the write. A retry that raced the first write would
 * otherwise double the thread's message count and re-preview it.
 */
export async function handleMetaInbound(params: MetaInboundParams) {
	const existingMessage = await findMessageByChannelId(params.messageId);
	if (existingMessage) {
		return { thread: null, message: null, duplicate: true as const };
	}

	const thread = await findOrCreateThread({
		channel: params.channel,
		contactExternalId: params.senderId
	});

	// Only on first contact. The lookup costs a Graph round trip inside a webhook
	// Meta expects answered in 20 seconds, and the answer does not change.
	let contactName = thread.contactName;
	if (!contactName) {
		const profile = await fetchMetaProfile(params.senderId);
		const resolved = profile?.name ?? (profile?.username ? `@${profile.username}` : null);
		if (resolved) {
			await setThreadContactName(thread.id, resolved);
			contactName = resolved;
		}
	}

	const message = await addInboundMessage({
		threadId: thread.id,
		body: params.body,
		// Falls back to the raw id: a thread named by number is worse than one
		// named by a person, and better than a message attributed to nobody.
		authorName: contactName ?? params.senderId,
		channelMessageId: params.messageId,
		channelMetadata: {
			timestamp: params.timestamp,
			// The placeholder body says *that* a photo arrived; this is where the
			// URL to it lives. Meta's CDN links expire, so it is a lead to follow
			// now rather than an archive.
			...(params.attachments ? { attachments: params.attachments } : {}),
			...(params.replyTo ? { replyTo: params.replyTo } : {})
		}
	});

	return { thread, message, duplicate: false as const };
}

export interface MetaEchoParams {
	channel: 'instagram' | 'messenger';
	/** The contact. On an echo Meta puts the Page in `sender` and the person in
	 *  `recipient`, which is the inversion that makes an unfiltered echo look
	 *  like the contact writing to us in our own words. */
	contactId: string;
	messageId: string;
	body: string;
	timestamp: number;
}

/**
 * A message the Page sent that we did not send from here.
 *
 * Staff answer DMs from their phones, and a thread that does not know about it
 * keeps reading as unanswered and keeps nagging the queue. Filed as outbound
 * through `recordOutboundMessage` rather than `addOutboundMessage`, because
 * Meta has already delivered it — dispatching would send it twice.
 *
 * The dedupe is also what catches the echo of our *own* reply, which arrives
 * carrying the `mid` that dispatch already stored on the message row.
 *
 * Creates a thread when there is none: a staff member opening a conversation
 * from the Instagram app is a real conversation, and the alternative is losing
 * it. Such a thread has an outbound message and no inbound one, which reads
 * correctly — answered, waiting on them.
 */
export async function handleMetaEcho(params: MetaEchoParams) {
	const existingMessage = await findMessageByChannelId(params.messageId);
	if (existingMessage) {
		return { thread: null, message: null, duplicate: true as const };
	}

	const thread = await findOrCreateThread({
		channel: params.channel,
		contactExternalId: params.contactId
	});

	const message = await recordOutboundMessage({
		threadId: thread.id,
		body: params.body,
		// No CMC account is behind this — Meta does not say which admin sent it —
		// so the timeline says where it came from instead of guessing at a person.
		authorUserId: null,
		authorName: params.channel === 'instagram' ? 'Sent from Instagram' : 'Sent from Messenger',
		channelMessageId: params.messageId,
		thread
	});

	return { thread, message, duplicate: false as const };
}

/**
 * Deliver a staff member's emailed reply to the contact and record it on the
 * thread. `addOutboundMessage` does both halves in the right order, so the
 * thread never shows a reply that was not actually sent.
 *
 * Both failure paths fall back to a note rather than throwing: the webhook route
 * answers 200 unconditionally, so Postmark never retries, and without a note the
 * staff member's text would be gone with nothing to show for it.
 */
async function relayStaffReply(params: {
	threadId: string;
	thread: Awaited<ReturnType<typeof findThreadById>>;
	staff: { id: string; name: string };
	body: string;
	fromEmail: string;
}) {
	const { threadId, thread, staff, body, fromEmail } = params;

	if (!body) {
		const note = await addNote({
			threadId,
			authorUserId: staff.id,
			body: `An empty reply arrived by email from ${fromEmail}. Nothing was sent to the contact.`
		});
		return { thread, message: null, note };
	}

	try {
		const message = await addOutboundMessage({
			threadId,
			body,
			authorUserId: staff.id,
			authorName: staff.name
		});
		return { thread, message };
	} catch (err) {
		captureException(err, { event: 'inbox.relay_failed', threadId, fromEmail });
		const note = await addNote({
			threadId,
			authorUserId: staff.id,
			body: `This emailed reply could not be delivered to the contact — send it from here:\n\n${body}`
		});
		return { thread, message: null, note };
	}
}
