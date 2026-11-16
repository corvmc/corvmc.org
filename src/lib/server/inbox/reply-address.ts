import { createHmac, timingSafeEqual } from 'crypto';
import * as env from '$app/env/private';

// ---------------------------------------------------------------------------
// Plus-addressed inbox reply addresses
// ---------------------------------------------------------------------------
// Outbound inbox replies carry a Reply-To of `reply+<hash>@<inbound domain>`,
// where <hash> encodes the thread the reply belongs to. Postmark parses the
// part after the `+` into the inbound payload's MailboxHash field, which lets
// us route the response straight back into its original thread instead of
// guessing from the sender address or from In-Reply-To headers.
//
// The hash is signed. Without a signature the address is a bearer token for
// writing into a thread, and it is visible to anyone the recipient forwards
// our reply to.
//
// Address length: `reply+` (6) + uuid (36) + `.` (1) + sig (12) = 55, inside
// RFC 5321's 64-character limit for a local part.
// ---------------------------------------------------------------------------

const SIGNATURE_LENGTH = 12;

function getSecret(): string {
	const secret = env.INBOX_REPLY_SECRET || env.POSTMARK_SERVER_TOKEN;
	if (!secret) throw new Error('No signing secret configured for inbox reply addresses');
	return secret;
}

function sign(threadId: string): string {
	return createHmac('sha256', getSecret())
		.update(threadId)
		.digest('base64url')
		.slice(0, SIGNATURE_LENGTH);
}

/**
 * Build the Reply-To address for a thread, or null when no inbound reply
 * address is configured (INBOX_REPLY_ADDRESS unset — callers should fall back
 * to a human-monitored mailbox so replies are not lost).
 */
export function buildReplyToAddress(threadId: string): string | null {
	const base = env.INBOX_REPLY_ADDRESS?.trim();
	if (!base) return null;

	const at = base.lastIndexOf('@');
	if (at <= 0 || at === base.length - 1) return null;

	const local = base.slice(0, at);
	const domain = base.slice(at + 1);

	return `${local}+${threadId}.${sign(threadId)}@${domain}`;
}

/**
 * Verify a MailboxHash from an inbound payload and return the thread id it
 * refers to. Returns null if the hash is malformed, unsigned, or tampered with.
 */
export function parseReplyMailboxHash(hash: string | null | undefined): string | null {
	if (!hash) return null;

	const dot = hash.lastIndexOf('.');
	if (dot <= 0 || dot === hash.length - 1) return null;

	const threadId = hash.slice(0, dot);
	const signature = hash.slice(dot + 1);

	let expected: string;
	try {
		expected = sign(threadId);
	} catch {
		return null;
	}

	const a = Buffer.from(signature);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	return threadId;
}
