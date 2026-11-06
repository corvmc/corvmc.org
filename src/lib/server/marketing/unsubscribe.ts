import { createHmac } from 'crypto';
import * as env from '$app/env/private';

// ---------------------------------------------------------------------------
// Unsubscribe token signing + verification
// ---------------------------------------------------------------------------
// Tokens encode subscriberId:audienceId and are signed with HMAC-SHA256.
// No expiry — unsubscribe links should work forever.
// ---------------------------------------------------------------------------

function getSecret(): string {
	const secret = env.MARKETING_UNSUBSCRIBE_SECRET || env.POSTMARK_SERVER_TOKEN;
	if (!secret) throw new Error('No signing secret configured for unsubscribe tokens');
	return secret;
}

function sign(payload: string): string {
	return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/**
 * Create a signed unsubscribe token for a subscriber + audience pair.
 */
export function signUnsubscribeToken(subscriberId: string, audienceId: string): string {
	const payload = `${subscriberId}:${audienceId}`;
	const signature = sign(payload);
	return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

/**
 * Verify and decode an unsubscribe token.
 * Returns the IDs if valid, null if tampered or malformed.
 */
export function verifyUnsubscribeToken(
	token: string
): { subscriberId: string; audienceId: string } | null {
	try {
		const decoded = Buffer.from(token, 'base64url').toString('utf-8');
		const parts = decoded.split(':');
		if (parts.length !== 3) return null;

		const [subscriberId, audienceId, signature] = parts;
		const expectedSignature = sign(`${subscriberId}:${audienceId}`);

		if (signature !== expectedSignature) return null;

		return { subscriberId, audienceId };
	} catch {
		return null;
	}
}
