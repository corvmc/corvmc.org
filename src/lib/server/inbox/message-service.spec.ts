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
vi.mock('$lib/server/events/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('./channel-dispatcher', () => ({
	dispatchReply: vi.fn().mockResolvedValue('sent-message-id')
}));

const { addInboundMessage, addOutboundMessage } = await import('./message-service');

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
