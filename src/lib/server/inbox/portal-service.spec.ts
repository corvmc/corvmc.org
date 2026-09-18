import { describe, it, expect, vi, beforeEach } from 'vitest';

// portal-service is the boundary between a signed-in member and a shared staff
// inbox. Two invariants matter more than anything else it does:
//
//   1. Ownership is enforced in the WHERE clause, via a join on
//      inbox_participant. Remote functions are the only guard in this app, and
//      a guard in the SQL cannot be forgotten at one call site.
//   2. Nothing here reads inbox_note. Notes are staff-private annotations, and
//      the reason these functions exist instead of reusing getThread().
//
// These tests pin both against the query the service actually builds.

const TABLES = {
	inboxThread: {
		__table: 'inbox_thread',
		id: 'thread.id',
		channel: 'thread.channel',
		status: 'thread.status',
		lastMessageAt: 'thread.lastMessageAt'
	},
	inboxMessage: { __table: 'inbox_message', threadId: 'message.threadId' },
	inboxNote: { __table: 'inbox_note' },
	inboxParticipant: {
		__table: 'inbox_participant',
		threadId: 'participant.threadId',
		userId: 'participant.userId',
		lastReadAt: 'participant.lastReadAt'
	}
};

/** Tables reached by any select/insert/update/join in the call under test. */
let touched: string[] = [];
/** Results handed to each awaited query, in order. */
let results: unknown[] = [];

function chain() {
	const self: Record<string, unknown> = {};
	const passthrough = [
		'where',
		'orderBy',
		'limit',
		'offset',
		'groupBy',
		'$dynamic',
		'set',
		'values',
		'returning'
	];
	for (const m of passthrough) self[m] = () => self;
	for (const m of ['from', 'innerJoin', 'leftJoin']) {
		self[m] = (table: { __table?: string }) => {
			if (table?.__table) touched.push(table.__table);
			return self;
		};
	}
	self.then = (resolve: (v: unknown) => unknown) => resolve(results.shift() ?? []);
	return self;
}

const dbUpdate = vi.fn();
const dbInsert = vi.fn();

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(),
		insert: (table: { __table?: string }) => {
			dbInsert(table);
			if (table?.__table) touched.push(table.__table);
			return chain();
		},
		update: (table: { __table?: string }) => {
			dbUpdate(table);
			if (table?.__table) touched.push(table.__table);
			return chain();
		}
	}
}));
vi.mock('$lib/server/db/schema/inbox', () => TABLES);

const eq = vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b }));
const inArray = vi.fn((a: unknown, b: unknown) => ({ op: 'inArray', a, b }));
vi.mock('drizzle-orm', () => ({
	eq: (...a: unknown[]) => eq(...(a as [unknown, unknown])),
	inArray: (...a: unknown[]) => inArray(...(a as [unknown, unknown])),
	and: (...a: unknown[]) => ({ op: 'and', a }),
	or: (...a: unknown[]) => ({ op: 'or', a }),
	desc: vi.fn(),
	asc: vi.fn(),
	count: vi.fn(),
	gt: vi.fn(),
	isNull: vi.fn(),
	sql: vi.fn()
}));

const paginate = vi.fn();
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
vi.mock('./message-service', () => ({
	addInboundMessage: (...a: unknown[]) => addInboundMessage(...(a as []))
}));

const {
	getPortalThread,
	listPortalThreads,
	replyToPortalThread,
	startPortalConversation,
	markPortalThreadRead,
	MAX_OPEN_PORTAL_THREADS
} = await import('./portal-service');

beforeEach(() => {
	vi.clearAllMocks();
	touched = [];
	results = [];
	findOrCreateThread.mockResolvedValue({ id: 'thread-new' });
	addInboundMessage.mockResolvedValue({ id: 'message-1' });
});

/** Did the service constrain a query on the caller's participant row? */
function joinedOnParticipant(userId: string) {
	return eq.mock.calls.some(([a, b]) => a === TABLES.inboxParticipant.userId && b === userId);
}

describe('getPortalThread', () => {
	it('never reads inbox_note', async () => {
		results = [[{ id: 'thread-1', subject: 'Locker', status: 'open' }], []];

		await getPortalThread('thread-1', 'member-1');

		expect(touched).toContain('inbox_thread');
		expect(touched).toContain('inbox_message');
		expect(touched).not.toContain('inbox_note');
	});

	it('constrains the thread to the caller and to the portal channel', async () => {
		results = [[{ id: 'thread-1', status: 'open' }], []];

		await getPortalThread('thread-1', 'member-1');

		expect(touched).toContain('inbox_participant');
		expect(joinedOnParticipant('member-1')).toBe(true);
		expect(eq).toHaveBeenCalledWith(TABLES.inboxThread.channel, 'portal');
		expect(eq).toHaveBeenCalledWith(TABLES.inboxThread.id, 'thread-1');
	});

	it('echoes the viewer id back', async () => {
		// The detail page orients its timeline off this. Without it the page has to
		// await a second query for the reader's identity, and awaiting
		// getMemberLayout() there deadlocks: the page's own mark-as-read effect
		// refreshes that query, which re-runs the effect (effect_update_depth_exceeded).
		results = [[{ id: 'thread-1', status: 'open' }], []];

		const thread = await getPortalThread('thread-1', 'member-1');

		expect(thread?.viewerUserId).toBe('member-1');
	});

	it('returns null when the thread is not the caller’s', async () => {
		results = [[]];
		expect(await getPortalThread('someone-elses', 'member-1')).toBeNull();
	});

	it('masks other people’s author ids so no staff id reaches the client', async () => {
		results = [
			[{ id: 'thread-1', status: 'open' }],
			[
				{ id: 'm1', body: 'hi', authorUserId: 'member-1', authorName: 'Robin' },
				{ id: 'm2', body: 'hello', authorUserId: 'staff-9', authorName: 'Ada' }
			]
		];

		const thread = await getPortalThread('thread-1', 'member-1');

		expect(thread?.messages[0].authorUserId).toBe('member-1');
		expect(thread?.messages[1].authorUserId).toBeNull();
		// The staff member's name is still shown — only the id is withheld.
		expect(thread?.messages[1].authorName).toBe('Ada');
	});
});

describe('listPortalThreads', () => {
	it('maps the unread flag to a boolean', async () => {
		paginate.mockResolvedValue({
			rows: [
				{ id: 'a', unread: 1 },
				{ id: 'b', unread: 0 }
			],
			pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 }
		});

		const result = await listPortalThreads('member-1', { page: 1 });

		expect(result.rows[0].unread).toBe(true);
		expect(result.rows[1].unread).toBe(false);
	});

	it('scopes the list to the caller and the portal channel', async () => {
		paginate.mockResolvedValue({ rows: [], pagination: {} });

		await listPortalThreads('member-1', { page: 1 });

		expect(joinedOnParticipant('member-1')).toBe(true);
		expect(eq).toHaveBeenCalledWith(TABLES.inboxThread.channel, 'portal');
	});
});

describe('replyToPortalThread', () => {
	const reply = { threadId: 'thread-1', userId: 'member-1', userName: 'Robin', body: 'thanks' };

	it('writes nothing when the thread does not match', async () => {
		// Covers "not yours", "not a portal thread", "resolved" and "missing"
		// alike — the query returns no row for any of them.
		results = [[]];

		expect(await replyToPortalThread(reply)).toBeNull();
		expect(addInboundMessage).not.toHaveBeenCalled();
	});

	it('restricts writes to open and snoozed threads', async () => {
		results = [[]];

		await replyToPortalThread(reply);

		expect(inArray).toHaveBeenCalledWith(TABLES.inboxThread.status, ['open', 'snoozed']);
	});

	it('attributes the message to the member and marks it read', async () => {
		results = [[{ id: 'thread-1', status: 'open' }], []];

		const result = await replyToPortalThread(reply);

		expect(result).toEqual({ messageId: 'message-1' });
		expect(addInboundMessage).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: 'thread-1', authorUserId: 'member-1' })
		);
		// Their own message must not come back to them as unread.
		expect(dbUpdate).toHaveBeenCalledWith(TABLES.inboxParticipant);
	});

	it('wakes a snoozed thread rather than leaving it parked', async () => {
		results = [[{ id: 'thread-1', status: 'snoozed' }], []];

		await replyToPortalThread(reply);

		expect(reopenThread).toHaveBeenCalledWith('thread-1');
	});

	it('leaves an open thread’s status alone', async () => {
		results = [[{ id: 'thread-1', status: 'open' }], []];

		await replyToPortalThread(reply);

		expect(reopenThread).not.toHaveBeenCalled();
	});
});

describe('startPortalConversation', () => {
	const start = {
		userId: 'member-1',
		userName: 'Robin',
		userEmail: 'robin@example.com',
		subject: 'Locker rental',
		body: 'Is one free?'
	};

	it('creates the thread, the participant row, and the first message', async () => {
		results = [[{ count: 0 }], [], []];

		const result = await startPortalConversation(start);

		expect(result).toEqual({ threadId: 'thread-new', messageId: 'message-1' });
		expect(findOrCreateThread).toHaveBeenCalledWith(
			expect.objectContaining({ channel: 'portal', subject: 'Locker rental' })
		);
		expect(dbInsert).toHaveBeenCalledWith(TABLES.inboxParticipant);
		expect(addInboundMessage).toHaveBeenCalledWith(
			expect.objectContaining({ authorUserId: 'member-1' })
		);
	});

	it('refuses once the member is at the open-conversation cap', async () => {
		results = [[{ count: MAX_OPEN_PORTAL_THREADS }]];

		expect(await startPortalConversation(start)).toBeNull();
		expect(findOrCreateThread).not.toHaveBeenCalled();
		expect(addInboundMessage).not.toHaveBeenCalled();
	});
});

describe('markPortalThreadRead', () => {
	it('can only move the caller’s own cursor', async () => {
		await markPortalThreadRead('thread-1', 'member-1');

		expect(dbUpdate).toHaveBeenCalledWith(TABLES.inboxParticipant);
		expect(eq).toHaveBeenCalledWith(TABLES.inboxParticipant.threadId, 'thread-1');
		expect(eq).toHaveBeenCalledWith(TABLES.inboxParticipant.userId, 'member-1');
	});
});
