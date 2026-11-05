import { error, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleTwilioInbound } from '#lib/server/inbox/inbound-handlers.js';
import { validateTwilioSignature } from '#lib/server/inbox/twilio-client.js';
import { isChannelEnabled } from '#lib/server/inbox/channel-config-service.js';

const EMPTY_TWIML = '<Response></Response>';

export const POST: RequestHandler = async ({ request, url }) => {
	// Not feature-flagged — the staff inbox is always available, so the `sms`
	// channel toggle below is what decides whether we accept inbound texts.
	const enabled = await isChannelEnabled('sms');
	if (!enabled) {
		return text(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml' } });
	}

	const body = await request.text();
	const params = Object.fromEntries(new URLSearchParams(body));

	const signature = request.headers.get('x-twilio-signature') ?? '';
	if (signature) {
		const valid = validateTwilioSignature(url.toString(), params, signature);
		if (!valid) {
			error(403, 'Invalid Twilio signature');
		}
	} else if (!import.meta.env.DEV) {
		error(403, 'Missing Twilio signature');
	}

	if (!params.From || !params.Body) {
		error(400, 'Missing required fields');
	}

	try {
		await handleTwilioInbound({
			From: params.From,
			To: params.To ?? '',
			Body: params.Body,
			MessageSid: params.MessageSid ?? '',
			NumMedia: params.NumMedia
		});
	} catch (err) {
		console.error('[inbox/twilio] Webhook handler failed:', err);
		if (import.meta.env.DEV) throw err;
	}

	return text('<Response></Response>', {
		headers: { 'Content-Type': 'text/xml' }
	});
};
