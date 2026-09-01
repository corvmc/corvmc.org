import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { suppressByEmail } from '$lib/server/marketing/subscriber-service';

// ---------------------------------------------------------------------------
// Postmark event webhook (bounces + spam complaints)
// ---------------------------------------------------------------------------
// Configured per-server in the Postmark dashboard (Settings -> Webhooks) with
// the Bounce and SpamComplaint events enabled. Authenticated with a shared
// secret in the `x-postmark-token` header (Postmark webhooks support a custom
// header / Basic Auth, not an HMAC signature). Marks the address globally
// suppressed so future campaign sends skip it.
//
// Postmark delivers one event per request:
//   - RecordType: 'SpamComplaint'           -> complaint
//   - RecordType: 'Bounce', permanent type  -> bounce
// Soft/transient bounces are ignored (the address may still be deliverable).
// ---------------------------------------------------------------------------

interface PostmarkEventPayload {
	RecordType?: string;
	Email?: string;
	Type?: string;
	TypeCode?: number;
	Inactive?: boolean;
}

// Permanent bounce types that should suppress the address. Anything else
// (SoftBounce, Transient, DnsError, etc.) is treated as recoverable.
const PERMANENT_BOUNCE_TYPES = new Set(['HardBounce', 'BadEmailAddress', 'Blocked']);

export const POST: RequestHandler = async ({ request }) => {
	const token = request.headers.get('x-postmark-token');
	const expectedToken = env.POSTMARK_WEBHOOK_TOKEN;
	if (!expectedToken || token !== expectedToken) {
		error(401, 'Invalid webhook token');
	}

	let payload: PostmarkEventPayload;
	try {
		payload = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const email = payload.Email?.trim();
	if (!email) {
		return json({ ok: true, skipped: 'no email' });
	}

	let reason: 'bounce' | 'complaint' | null = null;
	if (payload.RecordType === 'SpamComplaint') {
		reason = 'complaint';
	} else if (payload.RecordType === 'Bounce') {
		const permanent =
			payload.Inactive === true ||
			(payload.Type ? PERMANENT_BOUNCE_TYPES.has(payload.Type) : false);
		if (permanent) reason = 'bounce';
	}

	if (!reason) {
		return json({ ok: true, skipped: 'transient', recordType: payload.RecordType });
	}

	try {
		const suppressed = await suppressByEmail(email, reason);
		return json({ ok: true, reason, suppressed });
	} catch (err) {
		console.error('[webhooks/postmark/events] suppression failed:', err);
		if (import.meta.env.DEV) throw err;
		// Return 200 so Postmark doesn't retry a non-recoverable failure forever.
		return json({ ok: false });
	}
};
