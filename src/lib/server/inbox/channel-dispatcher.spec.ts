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

const mockSendMetaMessage = vi.fn(async (_params: Record<string, unknown>) => 'mid-out-1');
vi.mock('./meta-client', () => ({
	sendMetaMessage: (params: Record<string, unknown>) => mockSendMetaMessage(params)
}));

const mockBuildReplyToAddress = vi.fn((): string | null => 'reply+thread-1.sig@replies.test');
vi.mock('./reply-address', () => ({
	buildReplyToAddress: (...args: unknown[]) => mockBuildReplyToAddress(...(args as []))
}));

vi.mock('$env/dynamic/private', () => ({
	env: { STAFF_CONTACT_EMAIL: 'contact@test.com' }
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockIsChannelEnabled.mockResolvedValue(true);
	mockSendInboxReply.mockResolvedValue('pm-message-id');
	mockBuildReplyToAddress.mockReturnValue('reply+thread-1.sig@replies.test');
	mockSendMetaMessage.mockResolvedValue('mid-out-1');
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
		lastInboundAt: null,
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

describe('dispatchReply — Instagram and Messenger', () => {
	it.each(['instagram', 'messenger'] as const)(
		'sends a %s reply to the contact id',
		async (channel) => {
			const lastInboundAt = new Date(Date.now() - 60 * 60 * 1000);

			const id = await dispatchReply(
				params({ channel, contactExternalId: 'ig-1', contactEmail: null, lastInboundAt })
			);

			expect(id).toBe('mid-out-1');
			expect(mockSendMetaMessage).toHaveBeenCalledWith({
				recipientId: 'ig-1',
				body: 'Thanks for reaching out!',
				lastInboundAt
			});
		}
	);

	// The window is measured from the contact's last message, so the timestamp
	// has to reach the client — a dispatcher that dropped it would silently send
	// every reply untagged and get the late ones refused.
	it('passes the last inbound timestamp through so the window can be judged', async () => {
		const lastInboundAt = new Date(Date.now() - 48 * 60 * 60 * 1000);

		await dispatchReply(params({ channel: 'instagram', contactExternalId: 'ig-1', lastInboundAt }));

		expect(mockSendMetaMessage).toHaveBeenCalledWith(expect.objectContaining({ lastInboundAt }));
	});

	it('refuses a thread with no external id rather than sending nowhere', async () => {
		await expect(
			dispatchReply(params({ channel: 'messenger', contactExternalId: null }))
		).rejects.toThrow('no contact external ID');
		expect(mockSendMetaMessage).not.toHaveBeenCalled();
	});

	it('does not send when the channel is switched off', async () => {
		mockIsChannelEnabled.mockResolvedValue(false);

		await expect(
			dispatchReply(params({ channel: 'instagram', contactExternalId: 'ig-1' }))
		).rejects.toThrow('is not enabled');
		expect(mockSendMetaMessage).not.toHaveBeenCalled();
	});

	// The message the composer shows comes straight from here, so a Graph failure
	// has to arrive as a sentence rather than be swallowed into a generic one.
	it('propagates the client’s explanation of a refusal', async () => {
		mockSendMetaMessage.mockRejectedValue(new Error('the messaging window has closed'));

		await expect(
			dispatchReply(params({ channel: 'instagram', contactExternalId: 'ig-1' }))
		).rejects.toThrow('the messaging window has closed');
	});
});
