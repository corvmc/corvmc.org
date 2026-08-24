import { describe, it, expect, vi, beforeEach } from 'vitest';

// direct-service is the boundary between one member and another member's
// private conversation. Four things matter more than anything else it does:
//
//   1. Every branch that silently drops a message returns the SAME value.
//      Blocked, self-addressed, deactivated, hidden, messaging-off — a sender
//      who can tell those apart can tell a decline from an unopened request,
//      and the whole consent model rests on them not being able to.
//   2. replyToDirectThread builds ALL of its conditions. Each one alone returns
//      null on the happy-path mock, so a test that only checks "returned null"
//      passes after any single one is deleted.
//   3. getDirectThread does NOT hide the counterpart's authorUserId — the
//      opposite of portal-service, and the thing a "make these consistent"
//      refactor would break.
//   4. Nothing here reads inbox_note.

const TABLES = {
	inboxThread: {
		__table: 'inbox_thread',
		id: 'thread.id',
		channel: 'thread.channel',
		status: 'thread.status',
		preview: 'thread.preview',
		messageCount: 'thread.messageCount',
		lastMessageAt: 'thread.lastMessageAt',
		createdAt: 'thread.createdAt',
		$inferSelect: {}
	},
	inboxMessage: {
		__table: 'inbox_message',
		id: 'message.id',
		threadId: 'message.threadId',
		direction: 'message.direction',
		body: 'message.body',
		authorName: 'message.authorName',
		authorUserId: 'message.authorUserId',
		createdAt: 'message.createdAt'
	},
	inboxNote: { __table: 'inbox_note' },
	inboxParticipant: {
		__table: 'inbox_participant',
		id: 'participant.id',
		threadId: 'participant.threadId',
		userId: 'participant.userId',
		role: 'participant.role',
		lastReadAt: 'participant.lastReadAt',
		acceptedAt: 'participant.acceptedAt'
	}
};

let touched: string[] = [];
let results: unknown[] = [];
let inserted: { table: string; values: unknown }[] = [];
let selectedFields: Record<string, unknown>[] = [];

function chain(record?: (k: string, v: unknown) => void) {
	const self: Record<string, unknown> = {};
	for (const m of ['orderBy', 'limit', 'offset', 'groupBy', '$dynamic', 'set', 'returning']) {
		self[m] = () => self;
	}
	self.where = () => self;
	self.values = (v: unknown) => {
		record?.('values', v);
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
		select: (fields?: Record<string, unknown>) => {
			if (fields) selectedFields.push(fields);
			return chain();
		},
		insert: (table: { __table: string }) => {
			const entry = { table: table.__table, values: undefined as unknown };
			inserted.push(entry);
			touched.push(table.__table);
			return chain((k, v) => {
				if (k === 'values') entry.values = v;
			});
		},
		update: (table: { __table?: string }) => {
			if (table?.__table) touched.push(table.__table);
			return chain();
		},
		delete: () => chain()
	}
}));
vi.mock('$lib/server/db/schema/inbox', () => TABLES);
vi.mock('$lib/server/db/schema/authentication', () => ({
	user: {
		__table: 'user',
		id: 'user.id',
		name: 'user.name',
		deletedAt: 'user.deletedAt',
		directoryVisibility: 'user.directoryVisibility'
	}
}));
vi.mock('drizzle-orm/sqlite-core', () => ({
	alias: (t: unknown, name: string) => ({ ...(t as object), __alias: name })
}));
vi.mock('$lib/server/db/paginate', () => ({
	paginate: vi.fn(async () => ({ rows: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }))
}));

vi.mock('drizzle-orm', () => ({
	eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
	ne: (a: unknown, b: unknown) => ({ op: 'ne', a, b }),
	and: (...a: unknown[]) => ({ op: 'and', a }),
	or: (...a: unknown[]) => ({ op: 'or', a }),
	gt: (a: unknown, b: unknown) => ({ op: 'gt', a, b }),
	isNull: (a: unknown) => ({ op: 'isNull', a }),
	isNotNull: (a: unknown) => ({ op: 'isNotNull', a }),
	count: () => ({ op: 'count' }),
	desc: (a: unknown) => ({ op: 'desc', a }),
	sql: (strings: TemplateStringsArray, ...v: unknown[]) => ({
		op: 'sql',
		text: strings.join('?'),
		v
	})
}));

const addPeerMessage = vi.fn(async () => ({ id: 'msg-1' }));
vi.mock('./message-service', () => ({
	addPeerMessage: (...a: unknown[]) => addPeerMessage(...(a as [])),
	addInboundMessage: vi.fn(),
	addOutboundMessage: vi.fn()
}));

const markPortalThreadRead = vi.fn(async () => undefined);
vi.mock('./portal-service', () => ({
	markPortalThreadRead: (...a: unknown[]) => markPortalThreadRead(...(a as []))
}));

const updateStatus = vi.fn(async () => undefined);
vi.mock('./thread-service', () => ({
	updateStatus: (...a: unknown[]) => updateStatus(...(a as []))
}));

const isBlockedEitherWay = vi.fn(async () => false);
const blockUser = vi.fn(async () => undefined);
type Standing = {
	status: 'none' | 'restricted' | 'disabled';
	reason: string | null;
	triggeringFlagId: string | null;
	updatedAt: Date | null;
};
const getStanding = vi.fn(
	async (): Promise<Standing> => ({
		status: 'none',
		reason: null,
		triggeringFlagId: null,
		updatedAt: null
	})
);
// Reachability has two halves: a restriction (`getStanding`) and the member's
// own switch (`user.accepts_direct_messages`, which rides along on the
// recipient row). `messagingIsDisabled` is the one place they recombine.
const messagingIsDisabled = vi.fn(async () => false);
const acceptsDirectMessages = vi.fn(async () => true);
vi.mock('$lib/server/moderation/standing-service', () => ({
	getStanding: (...a: unknown[]) => getStanding(...(a as []))
}));
vi.mock('$lib/server/moderation/moderation-service', () => ({
	isBlockedEitherWay: (...a: unknown[]) => isBlockedEitherWay(...(a as [])),
	blockUser: (...a: unknown[]) => blockUser(...(a as [])),
	messagingIsDisabled: (...a: unknown[]) => messagingIsDisabled(...(a as [])),
	acceptsDirectMessages: (...a: unknown[]) => acceptsDirectMessages(...(a as []))
}));

const allowRateLimited = vi.fn(async () => true);
vi.mock('$lib/server/rate-limit', () => ({
	allowRateLimited: (...a: unknown[]) => allowRateLimited(...(a as []))
}));

const {
	startDirectThread,
	replyToDirectThread,
	acceptDirectThread,
	declineDirectThread,
	getDirectThread,
	countDirectUnread,
	listDirectThreads
} = await import('./direct-service');

beforeEach(() => {
	vi.clearAllMocks();
	touched = [];
	results = [];
	inserted = [];
	selectedFields = [];
	isBlockedEitherWay.mockResolvedValue(false);
	blockUser.mockResolvedValue(undefined);
	messagingIsDisabled.mockResolvedValue(false);
	acceptsDirectMessages.mockResolvedValue(true);
	allowRateLimited.mockResolvedValue(true);
	addPeerMessage.mockResolvedValue({ id: 'msg-1' });
	getStanding.mockResolvedValue({
		status: 'none',
		triggeringFlagId: null,
		reason: null,
		updatedAt: null
	});
});

const START = { senderId: 'alice', senderName: 'Alice', recipientId: 'bob', body: 'hi there' };

/** Queue the reads a clean startDirectThread performs. */
function happyStart() {
	results = [
		[{ id: 'bob', acceptsDirectMessages: true }], // recipient lookup
		[{ count: 0 }], // countOutstandingSentRequests
		[{ id: 'thread-new' }] // thread insert returning
	];
}

describe('startDirectThread — every silent drop looks identical', () => {
	// The single most important test in this file. Assert the results are equal
	// to *each other*, not each to a literal: a future "let's give a helpful
	// error here" change has to notice it is breaking something deliberate.
	async function outcomeWhen(setup: () => void) {
		vi.clearAllMocks();
		results = [];
		inserted = [];
		isBlockedEitherWay.mockResolvedValue(false);
		messagingIsDisabled.mockResolvedValue(false);
		acceptsDirectMessages.mockResolvedValue(true);
		getStanding.mockResolvedValue({
			status: 'none',
			triggeringFlagId: null,
			reason: null,
			updatedAt: null
		});
		allowRateLimited.mockResolvedValue(true);
		setup();
		const result = await startDirectThread(START);
		return { result, wrote: inserted.length > 0, messaged: addPeerMessage.mock.calls.length > 0 };
	}

	it('returns the same thing whether blocked, unknown, hidden, or switched off', async () => {
		const blocked = await outcomeWhen(() => {
			results = [[{ id: 'bob', acceptsDirectMessages: true }]];
			isBlockedEitherWay.mockResolvedValue(true);
		});
		const unknownOrHidden = await outcomeWhen(() => {
			results = [[]]; // recipient lookup finds nobody (deleted or hidden)
		});
		const switchedOffByStaff = await outcomeWhen(() => {
			results = [[{ id: 'bob', acceptsDirectMessages: true }]];
			getStanding.mockResolvedValue({
				status: 'disabled',
				triggeringFlagId: 'flag-1',
				reason: 'under 18',
				updatedAt: null
			});
		});
		// The member's own preference is a different table from the standing, and
		// deliberately indistinguishable from outside: telling a sender which one
		// stopped them would leak either a moderation decision or a personal choice.
		const switchedOffThemselves = await outcomeWhen(() => {
			results = [[{ id: 'bob', acceptsDirectMessages: false }]];
		});
		const self = await outcomeWhen(() => {
			results = [];
		});

		expect(blocked.result).toEqual(unknownOrHidden.result);
		expect(blocked.result).toEqual(switchedOffByStaff.result);
		expect(blocked.result).toEqual(switchedOffThemselves.result);
		expect(blocked.result).toEqual({ status: 'sent' });

		// And none of them wrote anything.
		for (const o of [blocked, unknownOrHidden, switchedOffByStaff, switchedOffThemselves]) {
			expect(o.wrote).toBe(false);
			expect(o.messaged).toBe(false);
		}
		void self;
	});

	it('stops a sender who switched their own messaging off, with no reason to give', async () => {
		// They already know why — they did it. Distinct from a staff restriction,
		// which quotes the note.
		results = [[{ id: 'bob', acceptsDirectMessages: true }]];
		acceptsDirectMessages.mockResolvedValue(false);
		expect(await startDirectThread(START)).toEqual({ status: 'restricted', reason: null });
		expect(inserted).toHaveLength(0);
	});

	it('refuses a self-addressed message without touching the database', async () => {
		const result = await startDirectThread({ ...START, recipientId: 'alice' });
		expect(result).toEqual({ status: 'sent' });
		expect(inserted).toHaveLength(0);
	});

	it('drops an empty message the same way', async () => {
		const result = await startDirectThread({ ...START, body: '   ' });
		expect(result).toEqual({ status: 'sent' });
		expect(inserted).toHaveLength(0);
	});
});

describe('startDirectThread — the branches that DO report back', () => {
	it('tells a restricted sender why, quoting the staff note', async () => {
		results = [[{ id: 'bob', acceptsDirectMessages: true }]];
		getStanding
			.mockResolvedValueOnce({
				status: 'none',
				reason: null,
				triggeringFlagId: null,
				updatedAt: null
			}) // recipient
			.mockResolvedValueOnce({
				status: 'restricted',
				triggeringFlagId: 'flag-1',
				reason: 'harassment',
				updatedAt: null
			}); // sender
		expect(await startDirectThread(START)).toEqual({
			status: 'restricted',
			reason: 'harassment'
		});
	});

	it('reports the pending-request cap', async () => {
		results = [[{ id: 'bob', acceptsDirectMessages: true }], [{ count: 5 }]];
		expect(await startDirectThread(START)).toEqual({ status: 'too_many_pending' });
		expect(inserted).toHaveLength(0);
	});

	it('checks the exact database count before spending a rate-limit hit', async () => {
		// DB truth first, KV backstop second — the reverse would burn the sender's
		// daily allowance on a request that was never going to be created.
		results = [[{ id: 'bob', acceptsDirectMessages: true }], [{ count: 5 }]];
		await startDirectThread(START);
		expect(allowRateLimited).not.toHaveBeenCalled();
	});

	it('reports being rate limited', async () => {
		results = [[{ id: 'bob', acceptsDirectMessages: true }], [{ count: 0 }]];
		allowRateLimited.mockResolvedValue(false);
		expect(await startDirectThread(START)).toEqual({ status: 'rate_limited' });
		expect(inserted).toHaveLength(0);
	});
});

describe('startDirectThread — what a successful request writes', () => {
	it('stamps the sender as accepted and leaves the recipient null', async () => {
		// That asymmetry IS the request mechanism. Both stamped would make it an
		// ordinary conversation; neither stamped would make it unanswerable.
		happyStart();
		await startDirectThread(START);

		const participants = inserted.find((i) => i.table === 'inbox_participant');
		expect(participants).toBeDefined();
		const rows = participants!.values as { userId: string; acceptedAt: Date | null }[];
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.userId === 'alice')!.acceptedAt).toBeInstanceOf(Date);
		expect(rows.find((r) => r.userId === 'bob')!.acceptedAt).toBeNull();
	});

	it('opens the thread on the direct channel', async () => {
		happyStart();
		await startDirectThread(START);
		const thread = inserted.find((i) => i.table === 'inbox_thread');
		expect(thread!.values).toMatchObject({ channel: 'direct', status: 'open' });
	});

	it('marks the sender as having read their own message', async () => {
		happyStart();
		await startDirectThread(START);
		expect(markPortalThreadRead).toHaveBeenCalledWith('thread-new', 'alice');
	});

	it('writes the message as a request, naming the recipient', async () => {
		happyStart();
		await startDirectThread(START);
		expect(addPeerMessage).toHaveBeenCalledWith(
			expect.objectContaining({ isRequest: true, recipientUserId: 'bob', authorUserId: 'alice' })
		);
	});
});

describe('replyToDirectThread', () => {
	function conditionsBuilt() {
		// The whole WHERE tree, flattened to the ops it used.
		const flat: string[] = [];
		const walk = (n: unknown) => {
			if (!n || typeof n !== 'object') return;
			const o = n as Record<string, unknown>;
			if (typeof o.op === 'string') flat.push(o.op === 'sql' ? String(o.text) : o.op);
			Object.values(o).forEach((v) => (Array.isArray(v) ? v.forEach(walk) : walk(v)));
		};
		andCalls.forEach(walk);
		return flat;
	}
	let andCalls: unknown[] = [];

	beforeEach(async () => {
		andCalls = [];
		const drizzle = await import('drizzle-orm');
		vi.spyOn(drizzle, 'and').mockImplementation((...a: unknown[]) => {
			const node = { op: 'and', a };
			andCalls.push(node);
			return node as never;
		});
	});

	it('returns null when the caller is not on a writable accepted thread', async () => {
		results = [[]];
		expect(
			await replyToDirectThread({ threadId: 't1', userId: 'alice', userName: 'Alice', body: 'yo' })
		).toBeNull();
	});

	it('builds every guard, not just one', async () => {
		// Each of these alone would produce "returned null" on an empty mock, so a
		// test asserting only the return value would survive deleting any single
		// one of them.
		results = [[]];
		await replyToDirectThread({ threadId: 't1', userId: 'alice', userName: 'Alice', body: 'yo' });
		const built = conditionsBuilt().join(' | ');

		expect(built).toContain('isNotNull'); // caller has accepted
		expect(built).toContain('accepted_at IS NOT NULL'); // counterpart has accepted
		expect(built).toContain('user_block'); // no block either way
		// Both halves of "switched off", and the table each lives in. Named
		// explicitly because these are raw `sql` strings: #224 renamed
		// messaging_standing to member_standing and nothing here or in the type
		// checker noticed, so every list 500'd until it reached production.
		expect(built).toContain('member_standing'); // staff switched them off…
		expect(built).toContain("ms.status = 'disabled'");
		expect(built).toContain('accepts_direct_messages'); // …or they did themselves
		expect(built).not.toContain('messaging_standing');
	});

	it('refuses an empty body without querying', async () => {
		expect(
			await replyToDirectThread({ threadId: 't1', userId: 'alice', userName: 'Alice', body: ' ' })
		).toBeNull();
		expect(touched).toHaveLength(0);
	});
});

describe('getDirectThread', () => {
	it('never reads inbox_note', async () => {
		results = [[{ id: 't1', counterpartId: 'bob' }], []];
		await getDirectThread('t1', 'alice');
		expect(touched).not.toContain('inbox_note');
	});

	it('does NOT mask the other member’s authorUserId', async () => {
		// The inverse of getPortalThread, which nulls it so no staff ids reach a
		// member. Here the counterpart is another member, their identity is the
		// point, and ThreadTimeline needs it to pick a side for each bubble.
		results = [[{ id: 't1', counterpartId: 'bob' }], []];
		await getDirectThread('t1', 'alice');

		const messageSelect = selectedFields.find((f) => 'authorUserId' in f);
		expect(messageSelect).toBeDefined();
		expect(messageSelect!.authorUserId).toBe(TABLES.inboxMessage.authorUserId);
	});

	it('serves a thread the caller has not accepted yet', async () => {
		// Report sits next to Accept and Decline on a request, and you can only
		// report what you can read. If someone "tidies up" this function by adding
		// the acceptedAt condition the list paths use, Report disappears from the
		// one place it matters most.
		results = [[{ id: 't1', counterpartId: 'bob', accepted: 0 }], []];
		const thread = await getDirectThread('t1', 'alice');
		expect(thread).not.toBeNull();
		expect(thread!.accepted).toBe(false);
		expect(thread!.messages).toEqual([]);
	});

	it('returns null when the caller is not a participant', async () => {
		results = [[]];
		expect(await getDirectThread('t1', 'mallory')).toBeNull();
	});
});

describe('the unread count', () => {
	// The pair that makes a request visible without being a nag: a request shows
	// in the Messages list, but never adds to the badge. Both halves need pinning
	// — if either drifts, an unconsented message either follows the recipient
	// around the site or disappears from where they would look for it.
	let andCalls: unknown[] = [];

	beforeEach(async () => {
		andCalls = [];
		const drizzle = await import('drizzle-orm');
		vi.spyOn(drizzle, 'and').mockImplementation((...a: unknown[]) => {
			const node = { op: 'and', a };
			andCalls.push(node);
			return node as never;
		});
	});

	function flatten(nodes: unknown[]): string[] {
		const flat: string[] = [];
		const walk = (n: unknown) => {
			if (!n || typeof n !== 'object') return;
			const o = n as Record<string, unknown>;
			if (typeof o.op === 'string') {
				flat.push(o.op === 'sql' ? String(o.text) : `${o.op}(${String(o.a)})`);
			}
			Object.values(o).forEach((v) => (Array.isArray(v) ? v.forEach(walk) : walk(v)));
		};
		nodes.forEach(walk);
		return flat;
	}

	it('countDirectUnread counts accepted threads only', async () => {
		results = [[{ count: 0 }]];
		await countDirectUnread('alice');
		const built = flatten(andCalls).join(' | ');
		// Accepted-only. Without this, a request bumps the nav badge.
		expect(built).toContain(`isNotNull(${TABLES.inboxParticipant.acceptedAt})`);
	});

	it('listDirectThreads does NOT filter requests out of the list', async () => {
		// The inverse of the above, and the reason they are tested together.
		await listDirectThreads('alice', { page: 1, pageSize: 25 });
		const built = flatten(andCalls).join(' | ');
		expect(built).not.toContain(`isNotNull(${TABLES.inboxParticipant.acceptedAt})`);
	});

	it('listDirectThreads tags each row so the UI can mark requests', async () => {
		await listDirectThreads('alice', { page: 1, pageSize: 25 });
		const listSelect = selectedFields.find((f) => 'pending' in f);
		expect(listSelect).toBeDefined();
	});
});

describe('declineDirectThread', () => {
	it('blocks the sender and closes the conversation', async () => {
		results = [[{ senderId: 'bob' }]];
		expect(await declineDirectThread('t1', 'alice')).toBe(true);
		expect(blockUser).toHaveBeenCalledWith({
			blockerUserId: 'alice',
			blockedUserId: 'bob',
			source: 'declined_request'
		});
		expect(updateStatus).toHaveBeenCalledWith('t1', 'resolved');
	});

	it('tells the declining member nothing to pass on to the sender', async () => {
		results = [[{ senderId: 'bob' }]];
		const result = await declineDirectThread('t1', 'alice');
		expect(result).toBe(true); // a bare boolean — no sender-facing payload
	});

	it('does nothing when there is no pending request', async () => {
		results = [[]];
		expect(await declineDirectThread('t1', 'alice')).toBe(false);
		expect(blockUser).not.toHaveBeenCalled();
		expect(updateStatus).not.toHaveBeenCalled();
	});
});

describe('acceptDirectThread', () => {
	// Both halves of "switched off" go through messagingIsDisabled, so accepting
	// is refused whether staff switched it off or the member did. Asserting on
	// the standing directly here would pass vacuously.
	it('refuses when the accepting member has messaging switched off', async () => {
		messagingIsDisabled.mockResolvedValue(true);
		expect(await acceptDirectThread('t1', 'alice')).toBe(false);
	});

	it('refuses when the two have a block between them', async () => {
		results = [[{ userId: 'bob' }]];
		isBlockedEitherWay.mockResolvedValue(true);
		expect(await acceptDirectThread('t1', 'alice')).toBe(false);
	});

	it('accepts an outstanding request', async () => {
		results = [[{ userId: 'bob' }], [{ id: 'participant-1' }]];
		expect(await acceptDirectThread('t1', 'alice')).toBe(true);
	});
});
