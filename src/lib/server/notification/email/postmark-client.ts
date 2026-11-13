import { ServerClient } from 'postmark';
import * as env from '$app/env/private';
import { captureException } from '#lib/server/sentry.js';
import { contactEmail } from '#lib/server/site-config/site-config-service.js';
import { createLogMailClient } from './log-mail-client';

// ---------------------------------------------------------------------------
// Postmark email client
// ---------------------------------------------------------------------------
// Thin wrapper around the Postmark SDK. Lazily initialised on first use
// so the server token isn't required during build/test.
// ---------------------------------------------------------------------------

// Postmark message streams, read from the environment. These are custom streams
// rather than Postmark's defaults (`outbound` / `broadcast`), so both must exist
// with the configured ids on the server POSTMARK_SERVER_TOKEN belongs to —
// otherwise Postmark rejects every send. Required under the postmark driver.

type MailClient = Pick<
	ServerClient,
	'sendEmailWithTemplate' | 'sendEmailBatch' | 'sendEmailBatchWithTemplates'
>;

let client: MailClient | null = null;

/**
 * `postmark` only when the environment asks for it, as `PAYMENTS_DRIVER` does
 * for Stripe. A dev checkout carries a real token, so the safe default is the
 * log driver; production opts in through `wrangler.toml`.
 */
export function mailDriver(): 'postmark' | 'log' {
	return env.MAIL_DRIVER === 'postmark' ? 'postmark' : 'log';
}

function getClient(): MailClient {
	if (client) return client;
	if (mailDriver() === 'log') return (client = createLogMailClient());

	const token = env.POSTMARK_SERVER_TOKEN;
	if (!token) {
		throw new Error('POSTMARK_SERVER_TOKEN is not configured');
	}

	client = new ServerClient(token);
	return client;
}

/** Drop the cached client, so a spec can switch drivers between cases. */
export function resetMailClient(): void {
	client = null;
}

function getBroadcastStream(): string {
	const stream = env.POSTMARK_BROADCAST_STREAM;
	if (!stream && mailDriver() === 'log') return 'log';
	if (!stream) throw new Error('POSTMARK_BROADCAST_STREAM is not configured');
	return stream;
}

function getTransactionalStream(): string {
	const stream = env.POSTMARK_TRANSACTIONAL_STREAM;
	if (!stream && mailDriver() === 'log') return 'log';
	if (!stream) throw new Error('POSTMARK_TRANSACTIONAL_STREAM is not configured');
	return stream;
}

// ---------------------------------------------------------------------------
// Broadcast batch sending (for marketing campaigns)
// ---------------------------------------------------------------------------

export interface BroadcastMessage {
	to: string;
	subject: string;
	htmlBody: string;
	tag?: string;
	metadata?: Record<string, string>;
	headers?: { Name: string; Value: string }[];
}

const BATCH_SIZE = 500;

/**
 * Send a batch of emails via Postmark's broadcast message stream.
 * Automatically chunks into batches of 500 (Postmark's limit).
 */
export async function sendBroadcastBatch(messages: BroadcastMessage[]): Promise<void> {
	if (messages.length === 0) return;

	const fromAddress = env.EMAIL_FROM_ADDRESS ?? 'noreply@corvmc.org';
	const fromName = env.EMAIL_FROM_NAME ?? 'CorvMC';
	const from = `${fromName} <${fromAddress}>`;
	const messageStream = getBroadcastStream();

	for (let i = 0; i < messages.length; i += BATCH_SIZE) {
		const chunk = messages.slice(i, i + BATCH_SIZE);

		try {
			await getClient().sendEmailBatch(
				chunk.map((msg) => ({
					From: from,
					To: msg.to,
					Subject: msg.subject,
					HtmlBody: msg.htmlBody,
					Tag: msg.tag,
					Metadata: msg.metadata,
					Headers: msg.headers,
					MessageStream: messageStream
				}))
			);
		} catch (err) {
			captureException(err, {
				event: 'email.send',
				kind: 'broadcast_batch',
				batchStart: i,
				batchSize: chunk.length
			});
			throw err;
		}
	}
}

// ---------------------------------------------------------------------------
// Template-based sending (Postmark-hosted templates)
// ---------------------------------------------------------------------------
// Transactional notifications render from templates stored in Postmark (source
// of truth in postmark/templates, pushed via `pnpm email:push`). Most use the
// generic `notification` template, whose subject + body come from the model.
// Every template send adds `contact_email`, which the shared layout's footer reads.

export interface SendTemplateParams {
	to: string;
	/** Postmark template alias, e.g. 'ticket-confirmation' */
	templateAlias: string;
	/** Mustachio model — values substituted into the template */
	model: Record<string, unknown>;
	/**
	 * Where a reply should go. Set it for any template the recipient can answer —
	 * From is `noreply@`, so without this their reply is silently lost. Templates
	 * that carry one are plaintext by convention (see postmark/templates).
	 */
	replyTo?: string | null;
	tag?: string;
	metadata?: Record<string, string>;
}

export async function sendEmailWithTemplate(params: SendTemplateParams): Promise<void> {
	const fromAddress = env.EMAIL_FROM_ADDRESS ?? 'noreply@corvmc.org';
	const fromName = env.EMAIL_FROM_NAME ?? 'CorvMC';
	const messageStream = getTransactionalStream();
	const contact_email = await contactEmail();

	try {
		await getClient().sendEmailWithTemplate({
			From: `${fromName} <${fromAddress}>`,
			To: params.to,
			ReplyTo: params.replyTo ?? undefined,
			TemplateAlias: params.templateAlias,
			TemplateModel: { ...params.model, contact_email },
			Tag: params.tag,
			Metadata: params.metadata,
			MessageStream: messageStream
		});
	} catch (err) {
		captureException(err, {
			event: 'email.send',
			kind: 'template',
			to: params.to,
			templateAlias: params.templateAlias,
			tag: params.tag
		});
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Template batch sending (for a group announcement's fan-out)
// ---------------------------------------------------------------------------

export interface TemplateBatchMessage {
	to: string;
	/** Per recipient: the mute link differs, so the models are not identical. */
	model: Record<string, unknown>;
}

/**
 * Send one templated email to many recipients in as few subrequests as possible.
 *
 * `sendEmailWithTemplate` in a loop does not work at group scale: it is one
 * outbound HTTPS call per recipient, awaited serially, against a Cloudflare
 * Worker's 1000-subrequest ceiling — and a failure halfway leaves half a roster
 * notified with no record of where it stopped. Postmark takes 500 per call, so
 * a 200-member group becomes one subrequest.
 *
 * On the **transactional** stream, like `sendEmailWithTemplate` and unlike
 * `sendBroadcastBatch`. That is deliberate and argued in
 * docs/decisions/0023-group-announcements-are-transactional-and-batched.md: an announcement is not marketing, you are getting
 * it because you joined a roster, and a marketing opt-out must not silence a
 * group somebody chose to be in. The cost of that choice is that a spam
 * complaint here lands on the stream that also carries password resets, which
 * is why every one of these emails has to carry a visible way to mute the
 * group.
 *
 * A chunk that fails is reported and re-thrown: the caller has already latched
 * the send, so a partial fan-out has to be visible rather than silent.
 */
export async function sendTemplateBatch(
	templateAlias: string,
	messages: TemplateBatchMessage[],
	opts: { tag?: string } = {}
): Promise<void> {
	if (messages.length === 0) return;

	const fromAddress = env.EMAIL_FROM_ADDRESS ?? 'noreply@corvmc.org';
	const fromName = env.EMAIL_FROM_NAME ?? 'CorvMC';
	const from = `${fromName} <${fromAddress}>`;
	const messageStream = getTransactionalStream();
	const contact_email = await contactEmail();

	for (let i = 0; i < messages.length; i += BATCH_SIZE) {
		const chunk = messages.slice(i, i + BATCH_SIZE);

		try {
			await getClient().sendEmailBatchWithTemplates(
				chunk.map((msg) => ({
					From: from,
					To: msg.to,
					TemplateAlias: templateAlias,
					TemplateModel: { ...msg.model, contact_email },
					Tag: opts.tag,
					MessageStream: messageStream
				}))
			);
		} catch (err) {
			captureException(err, {
				event: 'email.send',
				kind: 'template_batch',
				templateAlias,
				batchStart: i,
				batchSize: chunk.length
			});
			throw err;
		}
	}
}

// ---------------------------------------------------------------------------
// Inbox reply sending (with email threading headers)
// ---------------------------------------------------------------------------

export interface SendInboxReplyTemplateParams {
	to: string;
	/** Mustachio model: { subject, contactName, staffName, body } — `body` is plain text */
	model: Record<string, unknown>;
	/**
	 * Which template signs the message. Defaults to `inbox-reply`, which signs off
	 * as the Corvallis Music Collective. A band answering its own booking enquiry
	 * uses `band-reply`, whose signature and footer name the act instead.
	 */
	templateAlias?: string;
	/**
	 * The display name on the From address. Defaults to `EMAIL_FROM_NAME`. A band
	 * reply overrides it with "<Band> via CorvMC" so the booker's mail client shows
	 * who is writing; the address itself stays ours, which is where DKIM lives.
	 */
	fromName?: string;
	/** Where the recipient's response should go — a plus-addressed thread address */
	replyTo?: string | null;
	/** Original Message-ID for In-Reply-To header */
	inReplyTo?: string | null;
	/** Accumulated References header for threading */
	references?: string | null;
	metadata?: Record<string, string>;
}

export async function sendInboxReply(params: SendInboxReplyTemplateParams): Promise<string> {
	const fromAddress = env.EMAIL_FROM_ADDRESS ?? 'noreply@corvmc.org';
	const fromName = params.fromName ?? env.EMAIL_FROM_NAME ?? 'CorvMC';
	const messageStream = getTransactionalStream();

	const headers: Array<{ Name: string; Value: string }> = [];
	if (params.inReplyTo) {
		headers.push({ Name: 'In-Reply-To', Value: params.inReplyTo });
	}
	if (params.references) {
		headers.push({ Name: 'References', Value: params.references });
	}

	const contact_email = await contactEmail();

	try {
		const result = await getClient().sendEmailWithTemplate({
			From: `${fromName} <${fromAddress}>`,
			To: params.to,
			ReplyTo: params.replyTo ?? undefined,
			TemplateAlias: params.templateAlias ?? 'inbox-reply',
			TemplateModel: { ...params.model, contact_email },
			Tag: params.templateAlias ?? 'inbox-reply',
			Metadata: params.metadata,
			Headers: headers.length > 0 ? headers : undefined,
			MessageStream: messageStream
		});
		return result.MessageID;
	} catch (err) {
		captureException(err, {
			event: 'email.send',
			kind: 'inbox_reply',
			to: params.to
		});
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Per-message results (for the outbox)
// ---------------------------------------------------------------------------

export interface TemplatedEmail {
	to: string;
	templateAlias: string;
	model: Record<string, unknown>;
	replyTo?: string | null;
	tag?: string;
}

/** Postmark's MessageID for a message it took, or its reason for refusing one. */
export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

/**
 * Templated emails of any alias, 500 to a call, answered per message: Postmark
 * accepts a batch and refuses single messages inside it (an inactive recipient
 * is ErrorCode 406), so a whole-batch throw cannot say which ones went. A call
 * that throws fails every message in its chunk.
 */
export async function sendTemplatedEmails(messages: TemplatedEmail[]): Promise<SendResult[]> {
	if (messages.length === 0) return [];
	const fromAddress = env.EMAIL_FROM_ADDRESS ?? 'noreply@corvmc.org';
	const fromName = env.EMAIL_FROM_NAME ?? 'CorvMC';
	const contact_email = await contactEmail();

	const out: SendResult[] = [];
	for (let i = 0; i < messages.length; i += BATCH_SIZE) {
		const chunk = messages.slice(i, i + BATCH_SIZE);
		try {
			const messageStream = getTransactionalStream();
			const responses = await getClient().sendEmailBatchWithTemplates(
				chunk.map((msg) => ({
					From: `${fromName} <${fromAddress}>`,
					To: msg.to,
					ReplyTo: msg.replyTo ?? undefined,
					TemplateAlias: msg.templateAlias,
					TemplateModel: { ...msg.model, contact_email },
					Tag: msg.tag,
					MessageStream: messageStream
				}))
			);
			chunk.forEach((_, j) => {
				const r = responses[j];
				out.push(
					r && r.ErrorCode === 0
						? { ok: true, messageId: r.MessageID }
						: { ok: false, error: r ? `${r.ErrorCode}: ${r.Message}` : 'No response' }
				);
			});
		} catch (err) {
			captureException(err, { event: 'email.send', kind: 'outbox_batch', size: chunk.length });
			const error = err instanceof Error ? err.message : String(err);
			for (let j = 0; j < chunk.length; j++) out.push({ ok: false, error });
		}
	}
	return out;
}
