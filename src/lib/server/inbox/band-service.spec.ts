import { describe, it, expect, vi, beforeEach } from 'vitest';

// band-service is the boundary between one act and the enquiries its public
// booking form collects. Three invariants matter more than anything else it
// does, and each has a concrete failure behind it:
//
//   1. Ownership is `inbox_thread.group_id = <the resolved band>` in the WHERE
//      clause. The thread id is the only thing a client supplies, so without
//      this, one band's admin reads another band's booking negotiation by
//      guessing a uuid.
//   2. Nothing here reads inbox_note. Notes are staff-private, the same reason
//      portal-service exists instead of reusing getThread().
//   3. Nothing here writes inbox_participant. Every member-side query in
//      direct-service and portal-service finds its threads by joining that
//      table, so a participant row on a band thread would surface a booking
//      enquiry in /member/messages.
//
// These tests pin all three against the query the service actually builds.

const TABLES = {
	inboxThread: {
		__table: 'inbox_thread',
		id: 'thread.id',
		channel: 'thread.channel',
		groupId: 'thread.groupId',
		status: 'thread.status',
		awaitingReplySince: 'thread.awaitingReplySince',
		lastMessageAt: 'thread.lastMessageAt'
	},
	inboxMessage: { __table: 'inbox_message', threadId: 'message.threadId' },
	inboxNote: { __table: 'inbox_note' },
	inboxParticipant: { __table: 'inbox_participant' },
	inboxGroupRead: {
		__table: 'inbox_group_read',
		threadId: 'read.threadId',
		userId: 'read.userId',
		lastReadAt: 'read.lastReadAt'
	}
};

/** Tables reached by any select/insert/update/join in the call under test. */
let touched: string[] = [];
/** Results handed to each awaited query, in order. */
let results: unknown[] = [];
/** Every `set(...)` argument, in call order. */
let sets: unknown[] = [];

function chain() {
	const self: Record<string, unknown> = {};
	const passthrough = ['where', 'orderBy', 'limit', 'offset', 'groupBy', '$dynamic', 'values'];
	for (const m of passthrough) self[m] = () => self;
	self.set = (v: unknown) => {
		sets.push(v);
		return self;
	};
	self.returning = () => self;
	self.onConflictDoUpdate = () => self;
	for (const m of ['from', 'innerJoin', 'leftJoin']) {
		self[m] = (table: { __table?: string }) => {
			if (table?.__table) touched.push(table.__table);
			return self;
		};
	}
	self.then = (resolve: (v: unknown) => unknown) => resolve(results.shift() ?? []);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(),
		insert: (table: { __table?: string }) => {
			if (table?.__table) touched.push(table.__table);
			return chain();
		},
		update: (table: { __table?: string }) => {
			if (table?.__table) touched.push(table.__table);
			return chain();
		}
	}
}));
vi.mock('$lib/server/db/schema/inbox', () => TABLES);

const eq = vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b }));
vi.mock('drizzle-orm', () => ({
	eq: (...a: unknown[]) => eq(...(a as [unknown, unknown])),
	inArray: (a: unknown, b: unknown) => ({ op: 'inArray', a, b }),
	and: (...a: unknown[]) => ({ op: 'and', a }),
	or: (...a: unknown[]) => ({ op: 'or', a }),
	desc: vi.fn(),
	count: vi.fn(),
	gt: vi.fn(),
	isNull: vi.fn(),
	sql: vi.fn()
}));

vi.mock('$lib/config', () => ({ BAND_ENQUIRY_SUBJECT: 'Booking enquiry' }));

const paginate = vi.fn(async () => ({ rows: [], total: 0 }));
vi.mock('$lib/server/db/paginate', () => ({
	paginate: (...a: unknown[]) => paginate(...(a as []))
}));

const findOrCreateThread = vi.fn(async () => ({ id: 'thread-new' }));
const reopenThread = vi.fn(async () => undefined);
vi.mock('./thread-service', () => ({
	findOrCreateThread: (...a: unknown[]) => findOrCreateThread(...(a as [])),
	reopenThread: (...a: unknown[]) => reopenThread(...(a as []))
}));

const addInboundMessage = vi.fn(async () => ({ id: 'message-1' }));
const addOutboundMessage = vi.fn(async () => ({ id: 'message-2' }));
vi.mock('./message-service', () => ({
	addInboundMessage: (...a: unknown[]) => addInboundMessage(...(a as [])),
	addOutboundMessage: (...a: unknown[]) => addOutboundMessage(...(a as []))
}));

const {
	getBandThread,
	listBandThreads,
	handleBandEnquiry,
	replyToBandThread,
	setBandThreadStatus,
	markBandThreadRead,
	countBandUnread,
	bandOfThread
} = await import('./band-service');

beforeEach(() => {
	vi.clearAllMocks();
	touched = [];
	results = [];
	sets = [];
	paginate.mockResolvedValue({ rows: [], total: 0 });
	findOrCreateThread.mockResolvedValue({ id: 'thread-new' });
	addInboundMessage.mockResolvedValue({ id: 'message-1' });
	addOutboundMessage.mockResolvedValue({ id: 'message-2' });
});

/** Did the service constrain a query on the band that owns the thread? */
function scopedToBand(groupId: string) {
	return eq.mock.calls.some(([a, b]) => a === TABLES.inboxThread.groupId && b === groupId);
}

/** …and on the channel, so a portal or direct thread can never be reached here? */
function scopedToChannel() {
	return eq.mock.calls.some(([a, b]) => a === TABLES.inboxThread.channel && b === 'band');
}

describe('getBandThread', () => {
	it('scopes to the owning band and the band channel', async () => {
		results = [[{ id: 'thread-1', subject: 'Booking enquiry', status: 'open' }], []];

		await getBandThread('thread-1', 'band-1');

		expect(scopedToBand('band-1')).toBe(true);
		expect(scopedToChannel()).toBe(true);
	});

	it('never reads inbox_note', async () => {
		results = [[{ id: 'thread-1', status: 'open' }], []];

		await getBandThread('thread-1', 'band-1');

		expect(touched).toContain('inbox_thread');
		expect(touched).toContain('inbox_message');
		expect(touched).not.toContain('inbox_note');
	});

	it('returns null without fetching messages when the thread is another band’s', async () => {
		// The WHERE clause is what refuses, so the row simply is not there. If this
		// ever reads inbox_message first, the refusal has moved to a post-hoc check
		// on a conversation already loaded into memory.
		results = [[]];

		expect(await getBandThread('thread-1', 'band-1')).toBeNull();
		expect(touched).not.toContain('inbox_message');
	});

	it('does not return author user ids', async () => {
		results = [
			[{ id: 'thread-1', status: 'open' }],
			[{ id: 'm1', direction: 'outbound', body: 'yes', authorName: 'Wren' }]
		];

		const thread = await getBandThread('thread-1', 'band-1');

		// The timeline orients on `direction` — the band reads as an organisation,
		// like staff do — so a bandmate's id has no reader and is not sent.
		expect(thread?.messages[0]).not.toHaveProperty('authorUserId');
		expect(thread?.messages[0].authorName).toBe('Wren');
	});
});

describe('listBandThreads', () => {
	it('scopes to the owning band and never joins inbox_participant', async () => {
		await listBandThreads('band-1', 'user-1', { page: 1, pageSize: 20 });

		expect(scopedToBand('band-1')).toBe(true);
		expect(scopedToChannel()).toBe(true);
		expect(touched).not.toContain('inbox_participant');
		// The read cursor lives in its own table precisely so that it cannot.
		expect(touched).toContain('inbox_group_read');
	});
});

describe('handleBandEnquiry', () => {
	it('always opens a new thread, owned by the band', async () => {
		await handleBandEnquiry({
			groupId: 'band-1',
			name: 'Ada',
			email: 'ada@example.com',
			message: 'Can you play the 14th?'
		});

		expect(findOrCreateThread).toHaveBeenCalledWith(
			expect.objectContaining({
				channel: 'band',
				groupId: 'band-1',
				contactEmail: 'ada@example.com'
			})
		);
		expect(addInboundMessage).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: 'thread-new', authorName: 'Ada' })
		);
	});

	it('writes no participant row for the enquirer or the band', async () => {
		await handleBandEnquiry({
			groupId: 'band-1',
			name: 'Ada',
			email: 'ada@example.com',
			message: 'hello'
		});

		expect(touched).not.toContain('inbox_participant');
	});
});

describe('replyToBandThread', () => {
	it('refuses a thread that is not this band’s, without sending anything', async () => {
		results = [[]];

		expect(
			await replyToBandThread({
				threadId: 'thread-1',
				groupId: 'band-1',
				userId: 'user-1',
				userName: 'Wren',
				body: 'sure'
			})
		).toBeNull();
		expect(addOutboundMessage).not.toHaveBeenCalled();
	});

	it('sends through addOutboundMessage, which is what dispatches the email', async () => {
		results = [[{ id: 'thread-1', status: 'open' }], [{ id: 'thread-1' }]];

		const result = await replyToBandThread({
			threadId: 'thread-1',
			groupId: 'band-1',
			userId: 'user-1',
			userName: 'Wren',
			body: 'sure'
		});

		expect(scopedToBand('band-1')).toBe(true);
		expect(addOutboundMessage).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: 'thread-1', authorName: 'Wren', authorUserId: 'user-1' })
		);
		expect(result).toEqual({ messageId: 'message-2' });
	});
});

describe('setBandThreadStatus', () => {
	it('scopes the update to the owning band', async () => {
		results = [[{ id: 'thread-1' }]];

		expect(await setBandThreadStatus('thread-1', 'band-1', 'resolved')).toBe(true);
		expect(scopedToBand('band-1')).toBe(true);
	});

	it('clears the awaiting-reply marker when resolving, and not when reopening', async () => {
		results = [[{ id: 'thread-1' }]];
		await setBandThreadStatus('thread-1', 'band-1', 'resolved');
		expect(sets[0]).toMatchObject({ status: 'resolved', awaitingReplySince: null });

		sets = [];
		results = [[{ id: 'thread-1' }]];
		await setBandThreadStatus('thread-1', 'band-1', 'open');
		expect(sets[0]).not.toHaveProperty('awaitingReplySince');
	});

	it('reports false when the row belongs to someone else', async () => {
		results = [[]];
		expect(await setBandThreadStatus('thread-1', 'other-band', 'resolved')).toBe(false);
	});
});

describe('markBandThreadRead', () => {
	it('writes no cursor for a thread the band does not own', async () => {
		// Otherwise the row itself confirms a thread exists at that id.
		results = [[]];

		await markBandThreadRead('thread-1', 'band-1', 'user-1');

		expect(touched).not.toContain('inbox_group_read');
	});

	it('writes the cursor to inbox_group_read, never inbox_participant', async () => {
		results = [[{ id: 'thread-1' }], []];

		await markBandThreadRead('thread-1', 'band-1', 'user-1');

		expect(touched).toContain('inbox_group_read');
		expect(touched).not.toContain('inbox_participant');
	});
});

describe('countBandUnread', () => {
	it('counts only this band’s open threads', async () => {
		results = [[{ count: 3 }]];

		expect(await countBandUnread('band-1', 'user-1')).toBe(3);
		expect(scopedToBand('band-1')).toBe(true);
		expect(eq.mock.calls.some(([a, b]) => a === TABLES.inboxThread.status && b === 'open')).toBe(
			true
		);
	});
});

describe('bandOfThread', () => {
	it('answers null for a thread on any other channel', async () => {
		results = [[]];
		expect(await bandOfThread('thread-1')).toBeNull();
		expect(scopedToChannel()).toBe(true);
	});
});
