import { describe, it, expect, vi, beforeEach } from 'vitest';

// Topics are threads: `channel: 'group'` + group id + `subject`, a null
// subject meaning General (#1301). Nothing was migrated, so what matters is
// whether the rows already in the table still mean what they did: General is
// found by `subject IS NULL` rather than by being the only one, and it sorts
// first however quiet it gets. Plus the rule that keeps a fresh topic from
// wearing a dot nobody earned.

const TABLES = {
	inboxThread: {
		__table: 'inbox_thread',
		id: 'thread.id',
		channel: 'thread.channel',
		groupId: 'thread.groupId',
		subject: 'thread.subject',
		messageCount: 'thread.messageCount',
		lastMessageAt: 'thread.lastMessageAt'
	},
	inboxMessage: { __table: 'inbox_message', threadId: 'message.threadId' },
	inboxGroupRead: {
		__table: 'inbox_group_read',
		threadId: 'read.threadId',
		userId: 'read.userId',
		lastReadAt: 'read.lastReadAt'
	}
};

let results: unknown[] = [];
let insertedValues: unknown[] = [];
let lastWhere: unknown = null;
let lastOrderBy: unknown[] = [];

function chain() {
	const self: Record<string, unknown> = {};
	for (const m of [
		'limit',
		'offset',
		'groupBy',
		'$dynamic',
		'set',
		'returning',
		'onConflictDoUpdate'
	])
		self[m] = () => self;
	self.where = (w: unknown) => {
		lastWhere = w;
		return self;
	};
	self.orderBy = (...o: unknown[]) => {
		lastOrderBy = o;
		return self;
	};
	self.values = (v: unknown) => {
		insertedValues.push(v);
		return self;
	};
	for (const m of ['from', 'innerJoin', 'leftJoin']) self[m] = () => self;
	self.then = (resolve: (v: unknown) => unknown) => resolve(results.shift() ?? []);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: { select: () => chain(), insert: () => chain(), update: () => chain() }
}));
vi.mock('$lib/server/db/schema/inbox', () => TABLES);
vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { __table: 'user', id: 'user.id' }
}));
vi.mock('$lib/server/db/schema/group', () => ({
	group: { __table: 'group', id: 'group.id', name: 'group.name' },
	groupMember: { __table: 'group_member' }
}));
vi.mock('./message-service', () => ({ touchThread: vi.fn(async () => undefined) }));
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: vi.fn(), on: vi.fn() }
}));

vi.mock('drizzle-orm', () => ({
	eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
	and: (...a: unknown[]) => ({ op: 'and', a }),
	or: (...a: unknown[]) => ({ op: 'or', a }),
	desc: (a: unknown) => ({ op: 'desc', a }),
	asc: (a: unknown) => ({ op: 'asc', a }),
	count: () => ({ op: 'count' }),
	gt: (a: unknown, b: unknown) => ({ op: 'gt', a, b }),
	isNull: (a: unknown) => ({ op: 'isNull', a }),
	isNotNull: (a: unknown) => ({ op: 'isNotNull', a }),
	sql: (strings: TemplateStringsArray, ...v: unknown[]) => ({ op: 'sql', strings: [...strings], v })
}));

const {
	getOrCreateGroupChat,
	listGroupTopics,
	createGroupTopic,
	TopicNameTakenError,
	GENERAL_TOPIC
} = await import('./group-chat-service');

beforeEach(() => {
	results = [];
	insertedValues = [];
	lastWhere = null;
	lastOrderBy = [];
});

/** Every condition in the (possibly nested) `and`/`or` tree. */
function flatten(node: unknown): Record<string, unknown>[] {
	const n = node as Record<string, unknown>;
	if (!n || typeof n !== 'object') return [];
	if (n.op === 'and' || n.op === 'or') return (n.a as unknown[]).flatMap(flatten);
	return [n];
}

describe('getOrCreateGroupChat', () => {
	it('finds General by a null subject, not by being the only thread', async () => {
		// The lookup used to be (channel, groupId) alone, which was correct only
		// while a group could not have a second thread. With topics it would
		// return whichever one the database handed back first.
		results = [[{ id: 'general-1' }]];

		await expect(getOrCreateGroupChat('g1')).resolves.toBe('general-1');
		expect(flatten(lastWhere)).toContainEqual({ op: 'isNull', a: TABLES.inboxThread.subject });
	});

	it('creates General with no subject when the group has never opened one', async () => {
		results = [[], [{ id: 'general-new' }]];

		await expect(getOrCreateGroupChat('g1')).resolves.toBe('general-new');
		expect(insertedValues[0]).toEqual({ channel: 'group', groupId: 'g1', status: 'open' });
	});
});

describe('listGroupTopics', () => {
	const row = (over: Record<string, unknown> = {}) => ({
		id: 't1',
		subject: null,
		messageCount: 0,
		lastMessageAt: null,
		lastReadAt: null,
		...over
	});

	it('names a null subject General and marks it as such', async () => {
		results = [[{ id: 'general-1' }], [row({ id: 'general-1' })]];

		const [general] = await listGroupTopics('g1', 'u1');
		expect(general.name).toBe(GENERAL_TOPIC);
		expect(general.isGeneral).toBe(true);
	});

	it('sorts General first, then by most recent', async () => {
		results = [[{ id: 'general-1' }], []];
		await listGroupTopics('g1', 'u1');

		// `subject IS NULL` descending puts the null-subject row on top whatever
		// its last message says — the room you land in does not move.
		expect(lastOrderBy[0]).toMatchObject({ op: 'desc' });
		expect(lastOrderBy[1]).toEqual({ op: 'desc', a: TABLES.inboxThread.lastMessageAt });
	});

	it('marks a topic unread when it has said something since you last read', async () => {
		results = [
			[{ id: 'general-1' }],
			[row({ lastMessageAt: new Date('2026-02-02'), lastReadAt: new Date('2026-02-01') })]
		];

		expect((await listGroupTopics('g1', 'u1'))[0].unread).toBe(true);
	});

	it('leaves an empty topic read, however long you have ignored it', async () => {
		// Otherwise every topic wears a dot the moment somebody creates it, and
		// the badge is a number nobody can clear.
		results = [[{ id: 'general-1' }], [row({ lastMessageAt: null, lastReadAt: null })]];

		expect((await listGroupTopics('g1', 'u1'))[0].unread).toBe(false);
	});

	it('leaves a topic read once you have caught up', async () => {
		results = [
			[{ id: 'general-1' }],
			[row({ lastMessageAt: new Date('2026-02-01'), lastReadAt: new Date('2026-02-02') })]
		];

		expect((await listGroupTopics('g1', 'u1'))[0].unread).toBe(false);
	});
});

describe('createGroupTopic', () => {
	it('opens a named topic when the name is free', async () => {
		results = [[], [{ id: 'topic-1' }]];

		await expect(createGroupTopic('g1', '  Tour logistics  ')).resolves.toBe('topic-1');
		// Trimmed, because " Tour" and "Tour" are the same topic to a reader.
		expect(insertedValues[0]).toMatchObject({ subject: 'Tour logistics', groupId: 'g1' });
	});

	it('refuses a name the group already uses', async () => {
		results = [[{ id: 'existing' }]];

		await expect(createGroupTopic('g1', 'Tour logistics')).rejects.toBeInstanceOf(
			TopicNameTakenError
		);
		expect(insertedValues).toHaveLength(0);
	});

	// A second General would be unreachable beside the null-subject one, which
	// every list and lookup already calls General.
	it.each(['General', 'general', '  GENERAL '])('refuses %o', async (name) => {
		results = [[]];

		await expect(createGroupTopic('g1', name)).rejects.toBeInstanceOf(TopicNameTakenError);
		expect(insertedValues).toHaveLength(0);
	});
});
