import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DispatchReplyParams } from './channel-dispatcher';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIsChannelEnabled = vi.fn(async () => true);
vi.mock('./channel-config-service', () => ({
	isChannelEnabled: (...args: unknown[]) => mockIsChannelEnabled(...(args as []))
}));

const mockSendInboxReply = vi.fn(async (_params: Record<string, unknown>) => 'pm-message-id');
vi.mock('$lib/server/notification/email/postmark-client', () => ({
	sendInboxReply: (params: Record<string, unknown>) => mockSendInboxReply(params)
}));

const mockSendSms = vi.fn(async () => 'SM123');
vi.mock('./twilio-client', () => ({
	sendSms: (...args: unknown[]) => mockSendSms(...(args as []))
}));

const mockBuildReplyToAddress = vi.fn((): string | null => 'reply+thread-1.sig@replies.test');
vi.mock('./reply-address', () => ({
	buildReplyToAddress: (...args: unknown[]) => mockBuildReplyToAddress(...(args as []))
}));

vi.mock('$env/dynamic/private', () => ({
	env: { STAFF_CONTACT_EMAIL: 'contact@test.com' }
}));

// The band branch resolves the act's name, which is the whole reason it is a
// separate branch: it is what signs the message.
const mockBandRows = vi.fn((): unknown[] => [{ name: 'Wren Halloway' }]);
vi.mock('$lib/server/db', () => {
	const chain: Record<string, unknown> = {};
	for (const m of ['from', 'where', 'limit']) chain[m] = () => chain;
	chain.then = (resolve: (v: unknown) => unknown) => resolve(mockBandRows());
	return { db: { select: () => chain } };
});
vi.mock('$lib/server/db/schema/group', () => ({ group: { id: 'group.id', name: 'group.name' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }) }));

beforeEach(() => {
	vi.clearAllMocks();
	mockIsChannelEnabled.mockResolvedValue(true);
	mockSendInboxReply.mockResolvedValue('pm-message-id');
	mockBuildReplyToAddress.mockReturnValue('reply+thread-1.sig@replies.test');
	mockBandRows.mockReturnValue([{ name: 'Wren Halloway' }]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function params(overrides: Partial<DispatchReplyParams> = {}): DispatchReplyParams {
	return {
		channel: 'web',
		threadId: 'thread-1',
		body: 'Thanks for reaching out!',
		staffName: 'Dana',
		contactName: 'Charlie',
		contactEmail: 'charlie@example.com',
		contactPhone: null,
		contactExternalId: null,
		subject: 'General Inquiry',
		lastInboundMessageId: null,
		references: null,
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { dispatchReply } = await import('./channel-dispatcher');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchReply — web channel (contact form)', () => {
	it('sends the reply by email to the submitter', async () => {
		const messageId = await dispatchReply(params());

		expect(mockSendInboxReply).toHaveBeenCalledTimes(1);
		const arg = mockSendInboxReply.mock.calls[0][0];
		expect(arg.to).toBe('charlie@example.com');
		expect((arg.model as Record<string, unknown>).subject).toBe(`Re: ${params().subject}`);
		expect((arg.model as Record<string, unknown>).body).toBe('Thanks for reaching out!');
		expect(messageId).toBe('pm-message-id');
	});

	it('sets Reply-To to the plus-addressed thread address', async () => {
		await dispatchReply(params());

		expect(mockBuildReplyToAddress).toHaveBeenCalledWith('thread-1');
		const arg = mockSendInboxReply.mock.calls[0][0];
		expect(arg.replyTo).toBe('reply+thread-1.sig@replies.test');
	});

	it('falls back to the staff contact address when no reply address is configured', async () => {
		mockBuildReplyToAddress.mockReturnValue(null);

		await dispatchReply(params());

		const arg = mockSendInboxReply.mock.calls[0][0];
		expect(arg.replyTo).toBe('contact@test.com');
	});

	it('throws when the thread has no contact email', async () => {
		await expect(dispatchReply(params({ contactEmail: null }))).rejects.toThrow(
			/no contact email/i
		);
	});

	it('does not require the email channel toggle to be on', async () => {
		// isChannelEnabled is consulted for the thread's own channel ('web'), which is
		// always true — the 'email' channel toggle gates inbound mail, not outbound replies.

		await dispatchReply(params());

		expect(mockIsChannelEnabled).toHaveBeenCalledWith('web');
		expect(mockIsChannelEnabled).not.toHaveBeenCalledWith('email');
	});
});

describe('dispatchReply — email channel', () => {
	it('still sends with threading headers', async () => {
		await dispatchReply(
			params({
				channel: 'email',
				lastInboundMessageId: '<a@example.com>',
				references: '<a@example.com>'
			})
		);

		const arg = mockSendInboxReply.mock.calls[0][0];
		expect(arg.inReplyTo).toBe('<a@example.com>');
		expect(arg.references).toBe('<a@example.com>');
	});

	it('throws when the channel is disabled', async () => {
		mockIsChannelEnabled.mockResolvedValue(false);

		await expect(dispatchReply(params({ channel: 'email' }))).rejects.toThrow(/not enabled/i);
	});
});

describe('dispatchReply — portal channel', () => {
	// The member reads a portal reply in their own inbox: the stored message row
	// IS the delivery. Sending it out as a support email as well would double up
	// on the notification the inbox.message_sent listener already sends.
	it('sends nothing and reports no external message id', async () => {
		const result = await dispatchReply(
			params({ channel: 'portal', contactEmail: 'member@example.com' })
		);

		expect(result).toBeNull();
		expect(mockSendInboxReply).not.toHaveBeenCalled();
		expect(mockSendSms).not.toHaveBeenCalled();
	});

	it('is not blocked by a disabled channel config', async () => {
		// 'portal' is always-on, so isChannelEnabled reports true regardless of any
		// stored row — but pin that a false answer could not silently break replies.
		mockIsChannelEnabled.mockResolvedValue(true);

		await expect(dispatchReply(params({ channel: 'portal' }))).resolves.toBeNull();
	});
});

describe('dispatchReply — band channel', () => {
	function bandParams(overrides: Partial<DispatchReplyParams> = {}) {
		return params({ channel: 'band', groupId: 'band-1', subject: 'Booking enquiry', ...overrides });
	}

	it('sends on the band-reply template, signed with the act rather than CorvMC', async () => {
		// `inbox-reply` closes "Corvallis Music Collective" and tells the reader
		// they contacted us. Neither is true of a band answering its own form.
		await dispatchReply(bandParams());

		const sent = mockSendInboxReply.mock.calls[0][0];
		expect(sent.templateAlias).toBe('band-reply');
		expect(sent.fromName).toBe('Wren Halloway via CorvMC');
		expect((sent.model as Record<string, unknown>).bandName).toBe('Wren Halloway');
	});

	it('carries the signed per-thread Reply-To, so the booker can answer', async () => {
		await dispatchReply(bandParams());

		expect(mockBuildReplyToAddress).toHaveBeenCalledWith('thread-1');
		expect(mockSendInboxReply.mock.calls[0][0].replyTo).toBe('reply+thread-1.sig@replies.test');
	});

	it('never falls back to the staff mailbox when no reply address is configured', async () => {
		// The email path does, deliberately, so a response still reaches a human.
		// Here that human would be staff reading a booking negotiation they are not
		// party to, so the reply simply carries no Reply-To.
		mockBuildReplyToAddress.mockReturnValue(null);

		await dispatchReply(bandParams());

		expect(mockSendInboxReply.mock.calls[0][0].replyTo).toBeNull();
	});

	it('refuses a band thread with no owning band', async () => {
		await expect(dispatchReply(bandParams({ groupId: null }))).rejects.toThrow('no owning band');
		expect(mockSendInboxReply).not.toHaveBeenCalled();
	});
});
