import { describe, it, expect, vi, beforeEach } from 'vitest';

// The staff queue must never show a member↔member conversation unless it has
// been reported. That rule lives in one exported predicate, `staffVisibleThread`,
// and in a one-line refusal at the top of getThread().
//
// Both are easy to lose by accident: the predicate looks like just another
// filter and would be natural to move inside an `if (filters.…)` branch, and the
// getThread guard is a single statement in a function that otherwise has no
// authorisation logic at all. These tests fail if either moves.

const TABLES = {
	inboxThread: {
		__table: 'inbox_thread',
		id: 'thread.id',
		channel: 'thread.channel',
		status: 'thread.status',
		subject: 'thread.subject',
		preview: 'thread.preview',
		contactName: 'thread.contactName',
		contactEmail: 'thread.contactEmail',
		contactPhone: 'thread.contactPhone',
		contactExternalId: 'thread.contactExternalId',
		assignedToUserId: 'thread.assignedToUserId',
		snoozedUntil: 'thread.snoozedUntil',
		messageCount: 'thread.messageCount',
		lastMessageAt: 'thread.lastMessageAt',
		createdAt: 'thread.createdAt',
		updatedAt: 'thread.updatedAt'
	},
	inboxMessage: {
		__table: 'inbox_message',
		threadId: 'message.threadId',
		createdAt: 'm.createdAt'
	},
	inboxNote: {
		__table: 'inbox_note',
		id: 'note.id',
		threadId: 'note.threadId',
		authorUserId: 'note.authorUserId',
		body: 'note.body',
		createdAt: 'note.createdAt'
	},
	inboxParticipant: {
		__table: 'inbox_participant',
		threadId: 'participant.threadId',
		userId: 'participant.userId',
		role: 'participant.role'
	}
};

let touched: string[] = [];
let results: unknown[] = [];
/** Every `where(...)` argument, in call order. */
let wheres: unknown[] = [];

function chain() {
	const self: Record<string, unknown> = {};
	for (const m of ['orderBy', 'limit', 'offset', 'groupBy', '$dynamic', 'set', 'values']) {
		self[m] = () => self;
	}
	self.where = (w: unknown) => {
		wheres.push(w);
		return self;
	};
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
		insert: () => chain(),
		update: () => chain(),
		delete: () => chain()
	}
}));
vi.mock('$lib/server/db/schema/inbox', () => TABLES);
vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { __table: 'user', id: 'user.id', name: 'user.name' }
}));
vi.mock('drizzle-orm/sqlite-core', () => ({ alias: (t: unknown) => t }));
vi.mock('$lib/server/db/paginate', () => ({
	paginate: vi.fn(async () => ({ data: [], total: 0 }))
}));

vi.mock('drizzle-orm', () => ({
	eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
	ne: (a: unknown, b: unknown) => ({ op: 'ne', a, b }),
	and: (...a: unknown[]) => ({ op: 'and', a }),
	or: (...a: unknown[]) => ({ op: 'or', a }),
	like: (a: unknown, b: unknown) => ({ op: 'like', a, b }),
	desc: vi.fn(),
	count: vi.fn(),
	inArray: vi.fn(),
	isNull: vi.fn(),
	isNotNull: vi.fn(),
	lte: vi.fn(),
	sql: (strings: TemplateStringsArray, ...v: unknown[]) => ({
		op: 'sql',
		text: strings.join('?'),
		v
	})
}));

const {
	listThreads,
	getThread,
	getUnresolvedCount,
	countThreadsByStatus,
	listThreadsByContactEmail,
	staffVisibleThread
} = await import('./thread-service');

beforeEach(() => {
	touched = [];
	results = [];
	wheres = [];
});

/** Walk a nested predicate tree looking for the direct-channel exclusion. */
function containsDirectExclusion(node: unknown): boolean {
	if (node === staffVisibleThread) return true;
	if (!node || typeof node !== 'object') return false;
	const n = node as Record<string, unknown>;
	if (n.op === 'ne' && n.a === TABLES.inboxThread.channel && n.b === 'direct') return true;
	return Object.values(n).some((v) =>
		Array.isArray(v) ? v.some(containsDirectExclusion) : containsDirectExclusion(v)
	);
}

describe('staffVisibleThread', () => {
	it('excludes direct threads unless a pending flag exists', () => {
		// The predicate is an OR: not-direct, or a pending inbox_thread flag.
		// Both halves matter — the first is the rule, the second is the only way
		// back in.
		const node = staffVisibleThread as unknown as Record<string, unknown>;
		expect(node.op).toBe('or');
		const [notDirect, flagged] = node.a as Record<string, unknown>[];
		expect(notDirect).toMatchObject({ op: 'ne', a: TABLES.inboxThread.channel, b: 'direct' });
		expect(flagged.op).toBe('sql');
		expect(flagged.text).toContain('content_flag');
		expect(flagged.text).toContain("cf.entity_type = 'inbox_thread'");
		expect(flagged.text).toContain("cf.status = 'pending'");
	});
});

describe('listThreads', () => {
	it('applies the exclusion with no filters at all', async () => {
		// The regression this guards: the exclusion drifting inside an
		// `if (filters.…)` branch, where it would only apply on a filtered view.
		await listThreads({}, { page: 1, pageSize: 20 });
		expect(wheres.length).toBeGreaterThan(0);
		expect(wheres.every(containsDirectExclusion)).toBe(true);
	});

	it('still applies it alongside a search, which LIKEs the private preview', async () => {
		await listThreads({ search: 'hello' }, { page: 1, pageSize: 20 });
		expect(wheres.every(containsDirectExclusion)).toBe(true);
	});

	it('still applies it when filtering by channel', async () => {
		await listThreads({ channel: 'email' }, { page: 1, pageSize: 20 });
		expect(wheres.every(containsDirectExclusion)).toBe(true);
	});
});

describe('listThreadsByContactEmail', () => {
	it('applies the exclusion, rather than relying on a null contactEmail', async () => {
		// This one reads threads by a denormalised address and selects `preview`.
		// A direct thread has no contactEmail today, so it cannot match — but that
		// is an accident of what we happen to store, not a rule. This test is what
		// makes it a rule.
		await listThreadsByContactEmail('someone@example.com', { page: 1, pageSize: 10 });
		expect(wheres.length).toBeGreaterThan(0);
		expect(wheres.every(containsDirectExclusion)).toBe(true);
	});
});

describe('the aggregate counts', () => {
	it('getUnresolvedCount excludes direct threads from the staff badge', async () => {
		results = [[{ count: 3 }]];
		await getUnresolvedCount();
		expect(wheres.every(containsDirectExclusion)).toBe(true);
	});

	it('countThreadsByStatus excludes them from the status tabs', async () => {
		results = [[]];
		await countThreadsByStatus();
		expect(wheres.length).toBeGreaterThan(0);
		expect(wheres.every(containsDirectExclusion)).toBe(true);
	});
});

describe('getThread', () => {
	// Queue a *complete* result set every time, so that a getThread with its
	// refusal removed would sail through and return the conversation. Queuing
	// only the channel probe would make these pass either way — the second query
	// would come back empty and the function would return null for the wrong
	// reason.
	const fullDirectThread = () => [
		[{ channel: 'direct' }],
		[{ id: 'thread-1', channel: 'direct', subject: 'private' }],
		[{ id: 'm1', body: 'private words' }],
		[{ id: 'n1', body: 'staff note' }]
	];

	it('returns null for a direct thread even when every row is there to return', async () => {
		results = fullDirectThread();
		expect(await getThread('thread-1')).toBeNull();
	});

	it('reads no messages or notes for a direct thread', async () => {
		// Refused before the fetch, not filtered after it. If this ever reads
		// inbox_message or inbox_note for a direct thread, the conversation has
		// already been loaded into memory on a staff request.
		results = fullDirectThread();
		await getThread('thread-1');
		expect(touched).not.toContain('inbox_message');
		expect(touched).not.toContain('inbox_note');
	});

	it('returns null when the thread does not exist', async () => {
		results = [[]];
		expect(await getThread('nope')).toBeNull();
	});

	it('still serves a portal thread, notes and all', async () => {
		results = [[{ channel: 'portal' }], [{ id: 'thread-1', channel: 'portal' }], [], []];
		const thread = await getThread('thread-1');
		expect(thread).not.toBeNull();
		expect(touched).toContain('inbox_message');
		expect(touched).toContain('inbox_note');
	});
});
