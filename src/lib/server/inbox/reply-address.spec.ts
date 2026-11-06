import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock({
		INBOX_REPLY_ADDRESS: 'reply@replies.test',
		INBOX_REPLY_SECRET: 'test-signing-secret'
	})
);

const { buildReplyToAddress, parseReplyMailboxHash } = await import('./reply-address');

/** Pull the MailboxHash Postmark would parse out of a full address. */
function mailboxHash(address: string): string {
	return address.slice(address.indexOf('+') + 1, address.lastIndexOf('@'));
}

describe('buildReplyToAddress', () => {
	it('plus-addresses the thread id onto the configured address', () => {
		const address = buildReplyToAddress('thread-123');

		expect(address).toMatch(/^reply\+thread-123\.[A-Za-z0-9_-]{12}@replies\.test$/);
	});

	it('produces a local part within the RFC 5321 64-character limit for a UUID thread id', () => {
		const address = buildReplyToAddress('0a3d2f18-7c41-4b9e-8f2a-6d5c4b3a2e10');

		const local = address!.slice(0, address!.lastIndexOf('@'));
		expect(local.length).toBeLessThanOrEqual(64);
	});
});

describe('parseReplyMailboxHash', () => {
	it('round-trips a signed hash back to its thread id', () => {
		const address = buildReplyToAddress('thread-123');

		expect(parseReplyMailboxHash(mailboxHash(address!))).toBe('thread-123');
	});

	it('rejects a tampered thread id', () => {
		const address = buildReplyToAddress('thread-123');
		const forged = mailboxHash(address!).replace('thread-123', 'thread-999');

		expect(parseReplyMailboxHash(forged)).toBeNull();
	});

	it('rejects a tampered signature', () => {
		expect(parseReplyMailboxHash('thread-123.aaaaaaaaaaaa')).toBeNull();
	});

	it('rejects an unsigned or malformed hash', () => {
		expect(parseReplyMailboxHash('thread-123')).toBeNull();
		expect(parseReplyMailboxHash('.sig')).toBeNull();
		expect(parseReplyMailboxHash('thread-123.')).toBeNull();
		expect(parseReplyMailboxHash('')).toBeNull();
		expect(parseReplyMailboxHash(null)).toBeNull();
	});
});

describe('buildReplyToAddress without configuration', () => {
	it('returns null when INBOX_REPLY_ADDRESS is unset', async () => {
		vi.resetModules();
		vi.doMock('$app/env/private', async () =>
			(await import('#lib/testing/env-mock.js')).envMock({
				INBOX_REPLY_SECRET: 'test-signing-secret'
			})
		);

		const mod = await import('./reply-address');
		expect(mod.buildReplyToAddress('thread-123')).toBeNull();

		vi.doUnmock('$app/env/private');
		vi.resetModules();
	});
});
