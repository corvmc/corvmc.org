import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '$env/dynamic/private';

// ---------------------------------------------------------------------------
// Meta Graph API client — Instagram DMs and Facebook Messenger
// ---------------------------------------------------------------------------
// Everything that touches the Graph API or the raw webhook envelope lives here,
// the way `twilio-client.ts` holds the SMS equivalents, so the webhook route
// stays a router and the dispatcher stays a switch.
//
// One page token serves both channels. That only works because we send through
// `me/messages` on graph.facebook.com, which reaches an Instagram Professional
// account when it is linked to the Page and the app uses Facebook Login for
// Business. The other Instagram flavour — Instagram Login — speaks to
// graph.instagram.com with a token of its own and would need a second seam.
// See docs/architecture/meta-inbox-setup.md.
// ---------------------------------------------------------------------------

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * How long after the contact's last message Meta still accepts a plain reply.
 * Past it a message needs a tag, and past {@link HUMAN_AGENT_WINDOW_MS} nothing
 * gets through at all.
 */
export const STANDARD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What the HUMAN_AGENT tag buys: seven days, on both platforms. */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type MetaChannel = 'instagram' | 'messenger';

function getPageToken(): string {
	const token = env.META_PAGE_ACCESS_TOKEN;
	if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
	return token;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the `x-hub-signature-256` header against the raw request body.
 *
 * Constant-time, because the header is attacker-controlled and a plain `===`
 * on a hex digest leaks how many leading bytes were right. Node's crypto rather
 * than WebCrypto to match `reply-address.ts`, the other signature check in this
 * directory; `nodejs_compat` is on.
 */
export function verifyMetaSignature(body: string, header: string | null | undefined): boolean {
	const secret = env.META_APP_SECRET;
	if (!secret || !header) return false;

	const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

	const a = Buffer.from(header);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Webhook envelope
// ---------------------------------------------------------------------------

export interface MetaAttachment {
	type?: string;
	payload?: Record<string, unknown>;
}

export interface MetaMessage {
	mid?: string;
	text?: string;
	/** True on a message the Page sent — including the ones we sent ourselves. */
	is_echo?: boolean;
	attachments?: MetaAttachment[];
	/** Present when the contact replied to a story or to another message. */
	reply_to?: { mid?: string; story?: { url?: string; id?: string } };
}

export interface MetaMessagingEvent {
	sender?: { id?: string };
	recipient?: { id?: string };
	timestamp?: number;
	message?: MetaMessage;
	delivery?: unknown;
	read?: unknown;
	reaction?: unknown;
	postback?: unknown;
}

export interface MetaWebhookPayload {
	object?: string;
	entry?: Array<{
		id?: string;
		time?: number;
		messaging?: MetaMessagingEvent[];
		/** Instagram comments and @-mentions arrive here, not on `messaging`. */
		changes?: unknown[];
	}>;
}

export type NormalizedMetaEvent =
	| {
			kind: 'inbound';
			senderId: string;
			messageId: string;
			body: string;
			timestamp: number;
			attachments: MetaAttachment[] | null;
			replyTo: MetaMessage['reply_to'] | null;
	  }
	| {
			kind: 'echo';
			/**
			 * The contact. On an echo the roles invert — `sender` is the Page and
			 * `recipient` is the person — which is the detail that turns a reply we
			 * just sent into an inbound message from ourselves if you miss it.
			 */
			contactId: string;
			messageId: string;
			body: string;
			timestamp: number;
	  }
	| { kind: 'skip'; reason: string };

/**
 * What a single `entry[].messaging[]` item actually is.
 *
 * A discriminated union rather than a chain of `if (!event.message?.text)
 * continue` in the route: the three outcomes have genuinely different
 * consequences for thread state, and a `skip` that silently looks like an
 * inbound message is how a delivery receipt reopens a resolved thread.
 */
export function normalizeMetaEvent(event: MetaMessagingEvent): NormalizedMetaEvent {
	if (event.delivery) return { kind: 'skip', reason: 'delivery receipt' };
	if (event.read) return { kind: 'skip', reason: 'read receipt' };
	if (event.reaction) return { kind: 'skip', reason: 'reaction' };
	if (event.postback) return { kind: 'skip', reason: 'postback' };

	const message = event.message;
	if (!message) return { kind: 'skip', reason: 'no message payload' };

	const messageId = message.mid?.trim();
	// Without an id there is no dedupe key, and Meta redelivers for 36 hours.
	// Filing it would mean a duplicate on every retry.
	if (!messageId) return { kind: 'skip', reason: 'message has no mid' };

	const timestamp = event.timestamp ?? Date.now();
	const body = metaMessageBody(message);

	if (message.is_echo) {
		const contactId = event.recipient?.id?.trim();
		if (!contactId) return { kind: 'skip', reason: 'echo has no recipient id' };
		return { kind: 'echo', contactId, messageId, body, timestamp };
	}

	const senderId = event.sender?.id?.trim();
	if (!senderId) return { kind: 'skip', reason: 'message has no sender id' };

	return {
		kind: 'inbound',
		senderId,
		messageId,
		body,
		timestamp,
		attachments: message.attachments?.length ? message.attachments : null,
		replyTo: message.reply_to ?? null
	};
}

const ATTACHMENT_LABELS: Record<string, string> = {
	image: '[Photo]',
	video: '[Video]',
	audio: '[Voice message]',
	file: '[File]',
	share: '[Shared a post]',
	story_mention: '[Mentioned you in a story]',
	template: '[Shared a post]',
	fallback: '[Attachment]',
	ig_reel: '[Shared a reel]',
	reel: '[Shared a reel]'
};

/**
 * A readable body for a message that may carry no text at all.
 *
 * Most Instagram DM traffic is a story reply, a story mention or a shared reel.
 * Dropping those left staff with no thread and no idea anyone had written, so
 * they get a placeholder instead and the raw payload is kept on the message's
 * `channelMetadata` for whoever needs the URL.
 *
 * Never returns an empty string: `inbox_message.body` is NOT NULL and an empty
 * preview reads as a broken row rather than an attachment.
 */
export function metaMessageBody(message: MetaMessage): string {
	const text = message.text?.trim();

	const parts: string[] = [];
	if (message.reply_to?.story) parts.push('[Replied to your story]');

	for (const attachment of message.attachments ?? []) {
		const label = ATTACHMENT_LABELS[attachment.type ?? ''] ?? ATTACHMENT_LABELS.fallback;
		if (!parts.includes(label)) parts.push(label);
	}

	if (text) parts.push(text);
	if (parts.length > 0) return parts.join(' ');

	return '[Message]';
}

// ---------------------------------------------------------------------------
// Graph API
// ---------------------------------------------------------------------------

interface GraphError {
	error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

/**
 * Turn a Graph failure into something a staff member can act on.
 *
 * The two that matter both look identical from the composer otherwise — a
 * 400 with a JSON blob — and mean opposite things: one is "you waited too long",
 * which is nobody's fault and has a workaround, the other is "the integration
 * is down", which needs an admin. Anything unrecognised keeps the raw body so
 * a new failure mode is diagnosable rather than flattened.
 */
function graphErrorMessage(status: number, raw: string): string {
	let parsed: GraphError | null;
	try {
		parsed = JSON.parse(raw) as GraphError;
	} catch {
		parsed = null;
	}

	const code = parsed?.error?.code;
	const subcode = parsed?.error?.error_subcode;

	if (code === 10 && subcode === 2018278) {
		return 'Meta refused this reply: the messaging window has closed. You can only reply within 7 days of their last message — answer in the Instagram or Messenger app instead.';
	}
	if (code === 10) {
		return 'Meta refused this reply: the app does not hold the permission required to send it. Check the Meta app’s messaging permissions.';
	}
	if (code === 190) {
		return 'Meta rejected the page access token — it has expired or been revoked. Re-issue META_PAGE_ACCESS_TOKEN.';
	}
	if (code === 4 || code === 613) {
		return 'Meta is rate limiting this page. Wait a few minutes and send again.';
	}

	return `Meta API error (${status}): ${raw}`;
}

export interface SendMetaMessageParams {
	recipientId: string;
	body: string;
	/**
	 * When the contact last wrote. Null means we have never heard from them on
	 * this thread, which is treated as outside the standard window.
	 */
	lastInboundAt: Date | null;
}

/**
 * Send a message to a contact on Instagram or Messenger.
 *
 * Inside 24 hours of their last message this is an ordinary RESPONSE. Past
 * that, Meta requires a tag; HUMAN_AGENT is the one that fits — a person is
 * answering a person — and it extends the window to seven days. Sending it
 * requires the Human Agent permission on the app; without it Meta answers with
 * code 10, which {@link graphErrorMessage} translates.
 */
export async function sendMetaMessage(params: SendMetaMessageParams): Promise<string> {
	const token = getPageToken();

	const age = params.lastInboundAt ? Date.now() - params.lastInboundAt.getTime() : Infinity;
	const needsTag = age > STANDARD_WINDOW_MS;

	const response = await fetch(`${GRAPH_BASE}/me/messages`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			recipient: { id: params.recipientId },
			message: { text: params.body },
			...(needsTag
				? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }
				: { messaging_type: 'RESPONSE' })
		})
	});

	if (!response.ok) {
		throw new Error(graphErrorMessage(response.status, await response.text()));
	}

	const result = (await response.json()) as { message_id?: string };
	return result.message_id ?? '';
}

export interface MetaProfile {
	name: string | null;
	username: string | null;
}

/**
 * Look up a contact's display name.
 *
 * Without this a thread is titled with a raw PSID/IGSID and the inbox lists a
 * seventeen-digit number where a person's name goes. Non-fatal by design: the
 * lookup needs its own permission, it can 400 on a contact who has never
 * messaged the Page before, and none of that is worth losing the message over —
 * callers fall back to the id exactly as they did before.
 */
export async function fetchMetaProfile(id: string): Promise<MetaProfile | null> {
	let token: string;
	try {
		token = getPageToken();
	} catch {
		return null;
	}

	try {
		const response = await fetch(`${GRAPH_BASE}/${encodeURIComponent(id)}?fields=name,username`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!response.ok) return null;

		const result = (await response.json()) as { name?: string; username?: string };
		const name = result.name?.trim() || null;
		const username = result.username?.trim() || null;
		if (!name && !username) return null;

		return { name, username };
	} catch {
		return null;
	}
}

export interface MetaConnectionResult {
	ok: boolean;
	/** The Page the token belongs to, when the call succeeded. */
	pageName?: string;
	error?: string;
}

/**
 * Ask Meta who this token belongs to.
 *
 * The token is a Worker secret with no refresh path, so the only thing standing
 * between an expired token and replies that quietly stop sending is somebody
 * pressing this in Settings. Returns a result rather than throwing so the
 * settings page can render the failure instead of a 500.
 */
export async function testMetaConnection(): Promise<MetaConnectionResult> {
	let token: string;
	try {
		token = getPageToken();
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}

	try {
		const response = await fetch(`${GRAPH_BASE}/me?fields=name`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		const raw = await response.text();

		if (!response.ok) {
			return { ok: false, error: graphErrorMessage(response.status, raw) };
		}

		const result = JSON.parse(raw) as { name?: string };
		return { ok: true, pageName: result.name?.trim() || 'Unnamed page' };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
