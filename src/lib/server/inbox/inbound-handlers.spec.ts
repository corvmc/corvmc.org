import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PostmarkInboundPayload } from './inbound-handlers';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindOrCreateThread = vi.fn(async () => ({ id: 'new-thread', channel: 'email' }));
const mockFindThreadById = vi.fn(
	async (): Promise<Record<string, unknown> | undefined> => undefined
);
const mockReopenThread = vi.fn(async () => undefined);

vi.mock('./thread-service', () => ({
	findOrCreateThread: (...args: unknown[]) => mockFindOrCreateThread(...(args as [])),
	findThreadById: (...args: unknown[]) => mockFindThreadById(...(args as [])),
	reopenThread: (...args: unknown[]) => mockReopenThread(...(args as []))
}));

interface InboundMessageArgs {
	threadId: string;
	channelMessageId?: string | null;
	channelMetadata?: Record<string, unknown>;
	[key: string]: unknown;
}

const mockAddInboundMessage = vi.fn(async (_params: InboundMessageArgs) => ({ id: 'msg-1' }));
const mockAddOutboundMessage = vi.fn(async (_params: Record<string, unknown>) => ({
	id: 'out-1'
}));
const mockAddNote = vi.fn(async (_params: Record<string, unknown>) => ({ id: 'note-1' }));
vi.mock('./message-service', () => ({
	addInboundMessage: (params: InboundMessageArgs) => mockAddInboundMessage(params),
	addOutboundMessage: (params: Record<string, unknown>) => mockAddOutboundMessage(params),
	addNote: (params: Record<string, unknown>) => mockAddNote(params)
}));

const mockFindStaffUserByEmail = vi.fn(
	async (_email: string): Promise<{ id: string; name: string; email: string } | null> => null
);
vi.mock('$lib/server/authorization', () => ({
	findStaffUserByEmail: (email: string) => mockFindStaffUserByEmail(email)
}));

vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const mockParseReplyMailboxHash = vi.fn((): string | null => null);
vi.mock('./reply-address', () => ({
	parseReplyMailboxHash: (...args: unknown[]) => mockParseReplyMailboxHash(...(args as []))
}));

const mockIsChannelEnabled = vi.fn(async () => true);
vi.mock('./channel-config-service', () => ({
	isChannelEnabled: (...args: unknown[]) => mockIsChannelEnabled(...(args as []))
}));

const mockEmit = vi.fn();
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...args: unknown[]) => mockEmit(...(args as [])) }
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockFindOrCreateThread.mockResolvedValue({ id: 'new-thread', channel: 'email' });
	mockFindThreadById.mockResolvedValue(undefined);
	mockAddInboundMessage.mockResolvedValue({ id: 'msg-1' });
	mockAddOutboundMessage.mockResolvedValue({ id: 'out-1' });
	mockAddNote.mockResolvedValue({ id: 'note-1' });
	mockFindStaffUserByEmail.mockResolvedValue(null);
	mockParseReplyMailboxHash.mockReturnValue(null);
	mockIsChannelEnabled.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function payload(overrides: Partial<PostmarkInboundPayload> = {}): PostmarkInboundPayload {
	return {
		From: 'charlie@example.com',
		FromName: 'Charlie',
		FromFull: { Email: 'charlie@example.com', Name: 'Charlie' },
		To: 'reply+thread-1.sig@replies.test',
		Subject: 'Re: General Inquiry',
		TextBody: 'thanks!',
		HtmlBody: '<p>thanks!</p>',
		StrippedTextReply: 'thanks!',
		MessageID: 'postmark-guid',
		Date: '2026-08-03T00:00:00Z',
		Headers: [{ Name: 'Message-ID', Value: '<real-id@example.com>' }],
		Attachments: [],
		MailboxHash: 'thread-1.sig',
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
const { handlePostmarkInbound, handleContactForm } = await import('./inbound-handlers');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handlePostmarkInbound — MailboxHash routing', () => {
	it('appends a reply to the thread the hash names, without creating a new one', async () => {
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({ id: 'thread-1', channel: 'web', status: 'open' });

		const result = await handlePostmarkInbound(payload());

		expect(mockFindOrCreateThread).not.toHaveBeenCalled();
		expect(mockAddInboundMessage.mock.calls[0][0]).toMatchObject({ threadId: 'thread-1' });
		expect(result.thread).toMatchObject({ id: 'thread-1', channel: 'web' });
	});

	it('reopens a resolved thread when the contact replies', async () => {
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({ id: 'thread-1', channel: 'web', status: 'resolved' });

		await handlePostmarkInbound(payload());

		expect(mockReopenThread).toHaveBeenCalledWith('thread-1');
	});

	it('routes hash-addressed replies even when the email channel is off', async () => {
		mockIsChannelEnabled.mockResolvedValue(false);
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({ id: 'thread-1', channel: 'web', status: 'open' });

		await handlePostmarkInbound(payload());

		expect(mockAddInboundMessage).toHaveBeenCalledTimes(1);
	});

	it('stores the real Message-ID header rather than Postmark’s internal guid', async () => {
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({ id: 'thread-1', channel: 'web', status: 'open' });

		await handlePostmarkInbound(payload());

		expect(mockAddInboundMessage.mock.calls[0][0]).toMatchObject({
			channelMessageId: '<real-id@example.com>'
		});
	});

	it('does not overwrite the thread contact when a forwarded reply arrives', async () => {
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({
			id: 'thread-1',
			channel: 'web',
			status: 'open',
			contactEmail: 'charlie@example.com'
		});

		const result = await handlePostmarkInbound(
			payload({
				From: 'someone-else@example.com',
				FromFull: { Email: 'someone-else@example.com', Name: 'Forwarder' }
			})
		);

		expect(result.thread).toMatchObject({ contactEmail: 'charlie@example.com' });
		const metadata = mockAddInboundMessage.mock.calls[0][0].channelMetadata!;
		expect(metadata.fromEmail).toBe('someone-else@example.com');
	});
});

describe('handlePostmarkInbound — direct threads are never writable by email', () => {
	// The routing below this guard is deliberately channel-agnostic ("route it
	// straight back, whatever the thread's channel"), and its own comment notes
	// that anyone a forwarded alert reaches can write into the thread. That is
	// fine for the channels the org actually corresponds on. It is not fine for a
	// private member↔member conversation: a message filed this way lands with a
	// null authorUserId and renders as "not yours" to *both* participants.
	//
	// Nothing we send carries a reply address for a direct thread, so a hash
	// arriving for one is misrouted or forged either way. This is easy to lose in
	// a later refactor precisely because being channel-agnostic is the point of
	// the surrounding code.
	beforeEach(() => {
		mockParseReplyMailboxHash.mockReturnValue('dm-thread');
		mockFindThreadById.mockResolvedValue({ id: 'dm-thread', channel: 'direct', status: 'open' });
	});

	it('files nothing when a valid signed hash names a direct thread', async () => {
		await handlePostmarkInbound(payload());
		expect(mockAddInboundMessage).not.toHaveBeenCalled();
		expect(mockAddOutboundMessage).not.toHaveBeenCalled();
		expect(mockAddNote).not.toHaveBeenCalled();
	});

	it('reports the mail as ignored rather than pretending it landed', async () => {
		const result = await handlePostmarkInbound(payload());
		expect(result).toEqual({ thread: null, message: null });
	});

	it('does not reopen a resolved direct thread', async () => {
		mockFindThreadById.mockResolvedValue({
			id: 'dm-thread',
			channel: 'direct',
			status: 'resolved'
		});
		await handlePostmarkInbound(payload());
		expect(mockReopenThread).not.toHaveBeenCalled();
	});

	it('does not relay it even when the sender is staff', async () => {
		// Staff replying by mail is relayed on other channels. Not here: staff do
		// not write into member conversations at all.
		mockFindStaffUserByEmail.mockResolvedValue({
			id: 'staff-1',
			name: 'Sam',
			email: 'sam@corvmc.org'
		});
		await handlePostmarkInbound(payload());
		expect(mockAddOutboundMessage).not.toHaveBeenCalled();
	});

	it('does not fall through to creating a fresh email thread', async () => {
		// The failure mode if this were a `return` in the wrong place.
		await handlePostmarkInbound(payload());
		expect(mockFindOrCreateThread).not.toHaveBeenCalled();
	});
});

describe('handlePostmarkInbound — staff reply relay', () => {
	const STAFF = { id: 'staff-1', name: 'Ada', email: 'ada@corvmc.org' };

	/** A thread the hash resolves, plus a staff member on the From line. */
	function staffReplying(overrides: Partial<PostmarkInboundPayload> = {}) {
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({
			id: 'thread-1',
			channel: 'web',
			status: 'open',
			contactEmail: 'charlie@example.com'
		});
		mockFindStaffUserByEmail.mockResolvedValue(STAFF);
		return payload({
			From: STAFF.email,
			FromName: 'Ada',
			FromFull: { Email: STAFF.email, Name: 'Ada' },
			...overrides
		});
	}

	it('relays a staff reply to the contact and records it as outbound', async () => {
		await handlePostmarkInbound(staffReplying());

		expect(mockAddOutboundMessage).toHaveBeenCalledWith({
			threadId: 'thread-1',
			body: 'thanks!',
			authorUserId: 'staff-1',
			authorName: 'Ada'
		});
		// Recording it as inbound would attribute the staffer's words to the
		// contact and never deliver them.
		expect(mockAddInboundMessage).not.toHaveBeenCalled();
	});

	it('sends only the stripped reply, never the quoted alert', async () => {
		// The quoted alert carries the staff inbox URL and the internal reply
		// note — relaying it would ship both to a member of the public.
		await handlePostmarkInbound(
			staffReplying({
				StrippedTextReply: 'Sure, March works.',
				TextBody: 'Sure, March works.\n\nOn Tue, CorvMC wrote:\n> the whole alert'
			})
		);

		expect(mockAddOutboundMessage.mock.calls[0][0].body).toBe('Sure, March works.');
	});

	it('strips the quote itself when Postmark hands back nothing', async () => {
		await handlePostmarkInbound(
			staffReplying({
				StrippedTextReply: '',
				TextBody: 'Sure, March works.\n\nOn Tue, CorvMC wrote:\n> the whole alert'
			})
		);

		expect(mockAddOutboundMessage.mock.calls[0][0].body).toBe('Sure, March works.');
	});

	it('records a note instead of relaying an empty message', async () => {
		await handlePostmarkInbound(staffReplying({ StrippedTextReply: '', TextBody: '' }));

		expect(mockAddOutboundMessage).not.toHaveBeenCalled();
		expect(mockAddNote).toHaveBeenCalledTimes(1);
	});

	it('keeps the text as a note when the relay fails to send', async () => {
		// The webhook route always returns 200, so Postmark never retries — without
		// this the staff member's reply would vanish with no trace.
		mockAddOutboundMessage.mockRejectedValue(new Error('Postmark 502'));

		const result = await handlePostmarkInbound(staffReplying());

		expect(mockAddNote.mock.calls[0][0].body).toContain('thanks!');
		expect(result.message).toBeNull();
	});

	it('does not relay an out-of-office auto-reply', async () => {
		await handlePostmarkInbound(
			staffReplying({
				Headers: [
					{ Name: 'Message-ID', Value: '<ooo@example.com>' },
					{ Name: 'Auto-Submitted', Value: 'auto-replied' }
				]
			})
		);

		expect(mockAddOutboundMessage).not.toHaveBeenCalled();
		expect(mockAddInboundMessage).toHaveBeenCalledTimes(1);
	});

	it('does not relay when the staff member is the thread contact', async () => {
		// A staffer who used the contact form themselves — relaying would mail
		// them their own words and loop.
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({
			id: 'thread-1',
			channel: 'web',
			status: 'open',
			contactEmail: 'ADA@corvmc.org'
		});
		mockFindStaffUserByEmail.mockResolvedValue(STAFF);

		await handlePostmarkInbound(
			payload({
				From: 'ada@corvmc.org',
				FromFull: { Email: 'ada@corvmc.org', Name: 'Ada' }
			})
		);

		expect(mockAddOutboundMessage).not.toHaveBeenCalled();
		expect(mockAddInboundMessage).toHaveBeenCalledTimes(1);
	});

	it('still records a non-staff sender as inbound', async () => {
		// A contact forwarding our reply to a colleague who answers. The signed
		// address now circulates in staff mailboxes, so anyone holding it can
		// write to the thread — deliberately unchanged, pinned so tightening it
		// later is a decision rather than a side effect.
		mockParseReplyMailboxHash.mockReturnValue('thread-1');
		mockFindThreadById.mockResolvedValue({
			id: 'thread-1',
			channel: 'web',
			status: 'open',
			contactEmail: 'charlie@example.com'
		});
		mockFindStaffUserByEmail.mockResolvedValue(null);

		await handlePostmarkInbound(payload({ From: 'someone-else@example.com' }));

		expect(mockAddOutboundMessage).not.toHaveBeenCalled();
		expect(mockAddInboundMessage).toHaveBeenCalledTimes(1);
	});
});

describe('handlePostmarkInbound — fallback for unrecognised mail', () => {
	it('creates an email thread when there is no hash', async () => {
		await handlePostmarkInbound(payload({ MailboxHash: undefined }));

		expect(mockFindOrCreateThread).toHaveBeenCalledWith(
			expect.objectContaining({ channel: 'email', contactEmail: 'charlie@example.com' })
		);
	});

	it('records an unresolvable hash so the routing failure is diagnosable', async () => {
		await handlePostmarkInbound(payload({ MailboxHash: 'garbage.hash' }));

		const metadata = mockAddInboundMessage.mock.calls[0][0].channelMetadata!;
		expect(metadata.unresolvedMailboxHash).toBe('garbage.hash');
	});

	it('falls back to find-or-create when the hash names a thread that no longer exists', async () => {
		mockParseReplyMailboxHash.mockReturnValue('deleted-thread');
		mockFindThreadById.mockResolvedValue(undefined);

		await handlePostmarkInbound(payload());

		expect(mockFindOrCreateThread).toHaveBeenCalledTimes(1);
	});

	it('drops unsolicited mail when the email channel is disabled', async () => {
		mockIsChannelEnabled.mockResolvedValue(false);

		const result = await handlePostmarkInbound(payload({ MailboxHash: undefined }));

		expect(mockFindOrCreateThread).not.toHaveBeenCalled();
		expect(result.thread).toBeNull();
	});
});

describe('handleContactForm', () => {
	it('emits contact.form_submitted so staff get the alert email', async () => {
		mockFindOrCreateThread.mockResolvedValue({ id: 'thread-9', channel: 'web' });

		await handleContactForm({
			name: 'Charlie',
			email: 'charlie@example.com',
			subject: 'General Inquiry',
			message: 'Hello!'
		});

		expect(mockEmit).toHaveBeenCalledWith('contact.form_submitted', {
			threadId: 'thread-9',
			name: 'Charlie',
			email: 'charlie@example.com',
			subject: 'General Inquiry',
			message: 'Hello!'
		});
	});
});
