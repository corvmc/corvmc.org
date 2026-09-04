import { json, error, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { handleMetaInbound, handleMetaEcho } from '$lib/server/inbox/inbound-handlers';
import { isChannelEnabled } from '$lib/server/inbox/channel-config-service';
import {
	verifyMetaSignature,
	normalizeMetaEvent,
	type MetaWebhookPayload
} from '$lib/server/inbox/meta-client';

export const GET: RequestHandler = async ({ url }) => {
	const mode = url.searchParams.get('hub.mode');
	const token = url.searchParams.get('hub.verify_token');
	const challenge = url.searchParams.get('hub.challenge');

	const verifyToken = env.META_VERIFY_TOKEN;

	if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge) {
		return text(challenge);
	}

	error(403, 'Verification failed');
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.text();

	const signature = request.headers.get('x-hub-signature-256');
	if (signature) {
		if (!verifyMetaSignature(body, signature)) error(403, 'Invalid signature');
	} else if (!import.meta.env.DEV) {
		error(403, 'Missing signature');
	}

	let payload: MetaWebhookPayload;
	try {
		payload = JSON.parse(body);
	} catch {
		error(400, 'Invalid JSON body');
	}

	const channel: 'instagram' | 'messenger' =
		payload.object === 'instagram' ? 'instagram' : 'messenger';

	const enabled = await isChannelEnabled(channel);
	if (!enabled) {
		return json({ ok: true, skipped: 'channel disabled' });
	}

	for (const entry of payload.entry ?? []) {
		// `entry[].changes[]` carries Instagram comments and @-mentions. Not read
		// here: a comment is a public post on a piece of content, not a
		// conversation, and folding it into the thread queue would file it under
		// a contact who never wrote to us.
		for (const event of entry.messaging ?? []) {
			const normalized = normalizeMetaEvent(event);
			if (normalized.kind === 'skip') continue;

			// Per event rather than per request. A profile lookup on a new contact
			// is a Graph round trip inside a webhook Meta expects answered in 20
			// seconds; one slow or failing message should not cost us the batch,
			// and Meta redelivers the whole batch on a non-200 — which the dedupe
			// in the handlers is what makes safe.
			try {
				if (normalized.kind === 'echo') {
					await handleMetaEcho({
						channel,
						contactId: normalized.contactId,
						messageId: normalized.messageId,
						body: normalized.body,
						timestamp: normalized.timestamp
					});
				} else {
					await handleMetaInbound({
						channel,
						senderId: normalized.senderId,
						messageId: normalized.messageId,
						body: normalized.body,
						timestamp: normalized.timestamp,
						attachments: normalized.attachments,
						replyTo: normalized.replyTo
					});
				}
			} catch (err) {
				console.error(`[inbox/meta] Failed to handle ${channel} message:`, err);
				if (import.meta.env.DEV) throw err;
			}
		}
	}

	// Always 200. Meta retries a failed delivery for 36 hours and unsubscribes an
	// app that keeps failing, and a message we could not file is not a message a
	// retry will fix.
	return json({ ok: true });
};
