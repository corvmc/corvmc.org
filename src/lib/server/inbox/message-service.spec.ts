import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Who a conversation is waiting on, as written by the two functions that move
 * messages. `awaiting_reply_since` is set by replying and cleared by anything
 * arriving, and both writes are folded into thread updates that were already
 * happening — so what these assert on is the `set()` payload.
 *
 * A fake `db` that records those payloads, with drizzle and the schema left
 * real: `messageCount: sql\`... + 1\`` needs genuine columns to build.
 */
const calls = {
	updateSet: [] as Record<string, unknown>[],
	inserted: [] as Record<string, unknown>[]
};

/** FIFO of rows handed to each awaited select, in the order the code runs them. */
let selectQueue: unknown[][] = [];

vi.mock('$lib/server/db', () => {
	const chain = () => {
		const self: Record<string, unknown> = {};
		for (const method of ['from', 'where', 'orderBy', 'limit']) self[method] = () => self;
		self.then = (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []);
		return self;
	};
	return {
		db: {
			select: () => chain(),
			insert: () => ({
				values: (values: Record<string, unknown>) => ({
					returning: () => {
						calls.inserted.push(values);
						return Promise.resolve([{ id: 'message-1', ...values }]);
					}
				})
			}),
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => {
						calls.updateSet.push(values);
						return Promise.resolve();
					}
				})
			})
		}
	};
});
vi.mock('$lib/server/db/paginate', () => ({ paginate: vi.fn() }));
const mockEmit = vi.fn();
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...args: unknown[]) => mockEmit(...(args as [])) }
}));
vi.mock('./channel-dispatcher', () => ({
	dispatchReply: vi.fn().mockResolvedValue('sent-message-id')
}));

const { addInboundMessage, addOutboundMessage, recordOutboundMessage, findMessageByChannelId } =
	await import('./message-service');

const openThread = {
	id: 'thread-1',
	channel: 'web',
	status: 'open',
	contactName: 'Sarah Chen',
	contactEmail: 'sarah@example.com',
	contactPhone: null,
	contactExternalId: null,
	subject: 'General Inquiry'
};

/** The three selects `addOutboundMessage` runs: the thread, then two inbound-id reads. */
function queueOutboundReads(thread: Record<string, unknown>) {
	selectQueue = [[thread], [], []];
}

beforeEach(() => {
	calls.updateSet = [];
	calls.inserted = [];
	selectQueue = [];
	mockEmit.mockClear();
});

describe('addOutboundMessage', () => {
	it('marks the thread as waiting on the contact', async () => {
		queueOutboundReads(openThread);

		await addOutboundMessage({
			threadId: 'thread-1',
			body: 'Yes, we have a student rate.',
			authorUserId: 'staff-1',
			authorName: 'Alex Admin'
		});

		expect(calls.updateSet).toHaveLength(1);
		expect(calls.updateSet[0].awaitingReplySince).toBeInstanceOf(Date);
	});

	// The marker only means something on a thread that is still open; a parting
	// word sent after resolving should not resurrect it as a pending wait.
	it('leaves a resolved thread unmarked', async () => {
		queueOutboundReads({ ...openThread, status: 'resolved' });

		await addOutboundMessage({
			threadId: 'thread-1',
			body: 'Glad that sorted it out.',
			authorUserId: 'staff-1',
			authorName: 'Alex Admin'
		});

		expect(calls.updateSet[0].awaitingReplySince).toBeNull();
	});
});

describe('addInboundMessage', () => {
	// Cleared in touchThread rather than here, so every channel's inbound path
	// gets it — this test is the guard on that.
	it('clears the marker when the contact writes back', async () => {
		selectQueue = [[{ channel: 'web', contactName: 'Sarah Chen' }]];

		await addInboundMessage({
			threadId: 'thread-1',
			body: 'Perfect, thanks!',
			authorName: 'Sarah Chen'
		});

		expect(calls.updateSet).toHaveLength(1);
		expect(calls.updateSet[0].awaitingReplySince).toBeNull();
	});
});

describe('recordOutboundMessage', () => {
	// The half of addOutboundMessage that runs after dispatch, extracted so a
	// message Meta has already delivered can be filed without sending it twice.
	it('moves the thread on exactly as a dispatched reply does', async () => {
		await recordOutboundMessage({
			threadId: 'thread-1',
			body: 'Answered from the app',
			authorName: 'Sent from Instagram',
			authorUserId: null,
			channelMessageId: 'mid-out-1',
			thread: { ...openThread, channel: 'instagram' } as never
		});

		expect(calls.inserted[0]).toMatchObject({
			direction: 'outbound',
			authorUserId: null,
			channelMessageId: 'mid-out-1'
		});
		expect(calls.updateSet[0].lastOutboundAt).toBeInstanceOf(Date);
		expect(calls.updateSet[0].awaitingReplySince).toBeInstanceOf(Date);
	});

	// A resolved thread stays out of the queue: the awaiting badge only means
	// something on a thread that is still open.
	it('leaves a resolved thread unmarked', async () => {
		await recordOutboundMessage({
			threadId: 'thread-1',
			body: 'Answered from the app',
			authorName: 'Sent from Instagram',
			authorUserId: null,
			channelMessageId: 'mid-out-1',
			thread: { ...openThread, status: 'resolved' } as never
		});

		expect(calls.updateSet[0].awaitingReplySince).toBeNull();
	});

	// The lone listener acts on `portal` alone, and an echo is never portal — so
	// an event carrying a null sender is a payload nothing reads and every future
	// listener would have to remember to guard.
	it('emits nothing when no account is behind the message', async () => {
		await recordOutboundMessage({
			threadId: 'thread-1',
			body: 'Answered from the app',
			authorName: 'Sent from Instagram',
			authorUserId: null,
			channelMessageId: 'mid-out-1',
			thread: openThread as never
		});

		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('emits inbox.message_sent for a reply a staff member typed here', async () => {
		await recordOutboundMessage({
			threadId: 'thread-1',
			body: 'Thanks for reaching out',
			authorName: 'Dana',
			authorUserId: 'user-1',
			channelMessageId: 'sent-message-id',
			thread: openThread as never
		});

		expect(mockEmit).toHaveBeenCalledWith(
			'inbox.message_sent',
			expect.objectContaining({ threadId: 'thread-1', sentByUserId: 'user-1' })
		);
	});

	it('reads the thread itself when the caller did not pass one', async () => {
		selectQueue = [[openThread]];

		await recordOutboundMessage({
			threadId: 'thread-1',
			body: 'Answered from the app',
			authorName: 'Sent from Messenger',
			authorUserId: null,
			channelMessageId: 'mid-out-2'
		});

		expect(calls.inserted[0]).toMatchObject({ threadId: 'thread-1' });
	});

	it('refuses to file against a thread that does not exist', async () => {
		selectQueue = [[]];

		await expect(
			recordOutboundMessage({
				threadId: 'missing',
				body: 'x',
				authorName: 'Sent from Instagram',
				authorUserId: null,
				channelMessageId: 'mid-out-3'
			})
		).rejects.toThrow('Thread missing not found');
	});
});

describe('findMessageByChannelId', () => {
	it('returns the message already filed under that external id', async () => {
		selectQueue = [[{ id: 'message-9', channelMessageId: 'mid-1' }]];

		await expect(findMessageByChannelId('mid-1')).resolves.toMatchObject({ id: 'message-9' });
	});

	it('returns undefined when the id is new', async () => {
		selectQueue = [[]];

		await expect(findMessageByChannelId('mid-2')).resolves.toBeUndefined();
	});
});
