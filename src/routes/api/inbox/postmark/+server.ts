import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	handlePostmarkInbound,
	type PostmarkInboundPayload
} from '#lib/server/inbox/inbound-handlers.js';

/**
 * Postmark's inbound hook is a bare `InboundHookUrl` — unlike modular
 * (message-event) webhooks it cannot send custom headers, so the only
 * credential it can carry is HTTP Basic embedded in the URL:
 *   https://postmark:<POSTMARK_INBOUND_TOKEN>@corvmc.org/api/inbox/postmark
 * The `x-postmark-token` header is still accepted for local curl testing.
 */
function presentedToken(request: Request): string | null {
	const header = request.headers.get('x-postmark-token');
	if (header) return header;

	const auth = request.headers.get('authorization');
	if (!auth?.toLowerCase().startsWith('basic ')) return null;

	try {
		const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf-8');
		const colon = decoded.indexOf(':');
		return colon === -1 ? null : decoded.slice(colon + 1);
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	// Ingestion is not feature-flagged: the staff panel always has the inbox, so
	// inbound mail must always land. The per-channel toggle is the real switch.
	//
	// Note: the `email` channel toggle is checked inside handlePostmarkInbound,
	// and only for mail from a new sender. A reply to a thread we started must
	// land regardless of whether the support mailbox is switched on.
	const expectedToken = env.POSTMARK_INBOUND_TOKEN;
	if (!expectedToken || presentedToken(request) !== expectedToken) {
		error(401, 'Invalid inbound token');
	}

	let payload: PostmarkInboundPayload;
	try {
		payload = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (!payload.From && !payload.FromFull?.Email) {
		error(400, 'Missing sender information');
	}

	if (!payload.TextBody && !payload.HtmlBody) {
		error(400, 'Missing message body');
	}

	try {
		await handlePostmarkInbound(payload);
	} catch (err) {
		console.error('[inbox/postmark] Webhook handler failed:', err);
		if (import.meta.env.DEV) throw err;
	}

	return Response.json({ ok: true });
};
