import { describe, it, expect, vi, beforeEach } from 'vitest';

// Two rules carry most of the weight in this file, and both are the kind that
// look redundant to someone tidying up later:
//
//   1. Blocks are directional rows read in both directions. Unblocking removes
//      only your own row — if the other person blocked you too, theirs stands.
//   2. Reachability has two independent halves — a restriction staff or a
//      report imposed (`member_standing`), and the member's own switch
//      (`user.acceptsDirectMessages`). Either one alone makes a member
//      unreachable, and the member's switch can never lift a restriction,
//      because the two write different tables. The standing half is
//      standing-service.spec.ts's; what this file pins is that both halves are
//      consulted and that they stay independent.

const TABLES = {
	userBlock: {
		__table: 'user_block',
		id: 'block.id',
		blockerUserId: 'block.blockerUserId',
		blockedUserId: 'block.blockedUserId',
		source: 'block.source',
		createdAt: 'block.createdAt'
	}
};

let results: unknown[] = [];
let inserted: { table: string; values: unknown; conflict: unknown }[] = [];
let deleted: { table: string; where: unknown }[] = [];
let updated: { table: string; set: unknown }[] = [];
/** Every `where` a select built, in order. */
let selectWheres: unknown[] = [];

function chain(record?: (key: string, value: unknown) => void) {
	const self: Record<string, unknown> = {};
	for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'groupBy']) {
		self[m] = () => self;
	}
	self.where = (w: unknown) => {
		record?.('where', w);
		return self;
	};
	self.values = (v: unknown) => {
		record?.('values', v);
		return self;
	};
	self.set = (v: unknown) => {
		record?.('set', v);
		return self;
	};
	self.onConflictDoNothing = () => {
		record?.('conflict', 'nothing');
		return self;
	};
	self.onConflictDoUpdate = (c: unknown) => {
		record?.('conflict', c);
		return self;
	};
	self.then = (resolve: (v: unknown) => unknown) => resolve(results.shift() ?? []);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () =>
			chain((k, v) => {
				if (k === 'where') selectWheres.push(v);
			}),
		insert: (table: { __table: string }) => {
			const entry = {
				table: table.__table,
				values: undefined as unknown,
				conflict: undefined as unknown
			};
			inserted.push(entry);
			return chain((k, v) => {
				if (k === 'values') entry.values = v;
				if (k === 'conflict') entry.conflict = v;
			});
		},
		update: (table: { __table: string }) => {
			const entry = { table: table.__table, set: undefined as unknown };
			updated.push(entry);
			return chain((k, v) => {
				if (k === 'set') entry.set = v;
			});
		},
		delete: (table: { __table: string }) => {
			const entry = { table: table.__table, where: undefined as unknown };
			deleted.push(entry);
			return chain((k, v) => {
				if (k === 'where') entry.where = v;
			});
		}
	}
}));
vi.mock('$lib/server/db/schema/moderation', () => TABLES);
vi.mock('$lib/server/db/schema/authentication', () => ({
	user: {
		__table: 'user',
		id: 'user.id',
		name: 'user.name',
		acceptsDirectMessages: 'user.acceptsDirectMessages'
	}
}));

// Standing storage is standing-service.spec.ts's subject. Here it is a stub, so
// these tests assert how the two halves combine and nothing about the table.
type Standing = {
	status: string;
	reason: string | null;
	triggeringFlagId: string | null;
	updatedAt: Date | null;
};
const getStandingMock = vi.fn(
	async (): Promise<Standing> => ({
		status: 'none',
		reason: null,
		triggeringFlagId: null,
		updatedAt: null
	})
);
vi.mock('$lib/server/moderation/standing-service', () => ({
	getStanding: (...a: unknown[]) => getStandingMock(...(a as []))
}));

vi.mock('drizzle-orm', () => ({
	eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
	and: (...a: unknown[]) => ({ op: 'and', a }),
	or: (...a: unknown[]) => ({ op: 'or', a }),
	desc: vi.fn(),
	sql: (strings: TemplateStringsArray, ...v: unknown[]) => ({
		op: 'sql',
		text: strings.join('?'),
		v
	})
}));

const {
	blockUser,
	unblockUser,
	isBlockedEitherWay,
	blockExistsBetween,
	canInitiateMessages,
	messagingIsDisabled,
	setAcceptsDirectMessages,
	getMessagingState
} = await import('./moderation-service');

beforeEach(() => {
	results = [];
	inserted = [];
	deleted = [];
	updated = [];
	selectWheres = [];
	getStandingMock.mockResolvedValue({
		status: 'none',
		reason: null,
		triggeringFlagId: null,
		updatedAt: null
	});
});

describe('blockUser', () => {
	it('is idempotent — blocking twice writes one row', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'bob' });
		expect(inserted[0].table).toBe('user_block');
		expect(inserted[0].conflict).toBe('nothing');
	});

	it('records why, so staff have context without asking', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'bob', source: 'declined_request' });
		expect(inserted[0].values).toMatchObject({ source: 'declined_request' });
	});

	it('defaults to a manual block', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'bob' });
		expect(inserted[0].values).toMatchObject({ source: 'manual' });
	});

	it('refuses to let someone block themselves', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'alice' });
		expect(inserted).toHaveLength(0);
	});
});

describe('unblockUser', () => {
	it('removes only the caller’s own row', async () => {
		// If both people blocked each other, lifting one must leave the other
		// standing. Deleting "the pair" would let either party unilaterally
		// reopen a channel the other closed.
		await unblockUser('alice', 'bob');
		expect(deleted).toHaveLength(1);
		const where = deleted[0].where as Record<string, unknown>;
		expect(where.op).toBe('and');
		const parts = where.a as Record<string, unknown>[];
		expect(parts).toEqual([
			{ op: 'eq', a: TABLES.userBlock.blockerUserId, b: 'alice' },
			{ op: 'eq', a: TABLES.userBlock.blockedUserId, b: 'bob' }
		]);
	});
});

describe('block checks read both directions', () => {
	it('isBlockedEitherWay ORs the two orderings', async () => {
		// A check that only asks "did the sender block the recipient" lets a
		// blocked person keep writing to the person who blocked them. Both
		// orderings have to be in the query.
		results = [[]];
		await isBlockedEitherWay('alice', 'bob');

		expect(selectWheres).toHaveLength(1);
		const where = selectWheres[0] as Record<string, unknown>;
		expect(where.op).toBe('or');

		const [first, second] = where.a as Record<string, unknown>[];
		expect(first.a).toEqual([
			{ op: 'eq', a: TABLES.userBlock.blockerUserId, b: 'alice' },
			{ op: 'eq', a: TABLES.userBlock.blockedUserId, b: 'bob' }
		]);
		expect(second.a).toEqual([
			{ op: 'eq', a: TABLES.userBlock.blockerUserId, b: 'bob' },
			{ op: 'eq', a: TABLES.userBlock.blockedUserId, b: 'alice' }
		]);
	});

	it('reports a block found in either direction', async () => {
		results = [[{ id: 'block-1' }]];
		expect(await isBlockedEitherWay('alice', 'bob')).toBe(true);
		results = [[]];
		expect(await isBlockedEitherWay('alice', 'bob')).toBe(false);
	});

	it('blockExistsBetween names both people on both sides', () => {
		const fragment = blockExistsBetween('alice', 'bob') as unknown as Record<string, unknown>;
		expect(fragment.op).toBe('sql');
		expect(fragment.text).toContain('user_block');
		// alice and bob each appear twice: once as blocker, once as blocked.
		const values = fragment.v as string[];
		expect(values.filter((v) => v === 'alice')).toHaveLength(2);
		expect(values.filter((v) => v === 'bob')).toHaveLength(2);
	});
});

describe('canInitiateMessages', () => {
	it('is about the restriction only — a member who switched themselves off may still reply', async () => {
		// Their own switch stops people reaching them; it is not a finding against
		// them, so it does not close conversations they are already in.
		getStandingMock.mockResolvedValue({
			status: 'none',
			reason: null,
			triggeringFlagId: null,
			updatedAt: null
		});
		expect(await canInitiateMessages('alice')).toBe(true);
	});

	it('a restricted member may not start conversations', async () => {
		getStandingMock.mockResolvedValue({
			status: 'restricted',
			reason: null,
			triggeringFlagId: null,
			updatedAt: null
		});
		expect(await canInitiateMessages('alice')).toBe(false);
	});
});

describe('messagingIsDisabled — the two halves', () => {
	it('is true when staff switched messaging off', async () => {
		results = [[{ acceptsDirectMessages: true }]];
		getStandingMock.mockResolvedValue({
			status: 'disabled',
			reason: 'under 18',
			triggeringFlagId: null,
			updatedAt: null
		});
		expect(await messagingIsDisabled('alice')).toBe(true);
	});

	it('is true when the member switched it off themselves', async () => {
		results = [[{ acceptsDirectMessages: false }]];
		expect(await messagingIsDisabled('alice')).toBe(true);
	});

	// The caller gets one boolean and cannot tell which half produced it. That is
	// deliberate: telling a sender would leak either a moderation decision or a
	// personal preference.
	it('is false only when neither half says so', async () => {
		results = [[{ acceptsDirectMessages: true }]];
		expect(await messagingIsDisabled('alice')).toBe(false);
	});

	it('a report-driven restriction does not make someone unreachable', async () => {
		// `restricted` is reply-only for the restricted member. Other people can
		// still write to them — that is what separates it from `disabled`.
		results = [[{ acceptsDirectMessages: true }]];
		getStandingMock.mockResolvedValue({
			status: 'restricted',
			reason: null,
			triggeringFlagId: null,
			updatedAt: null
		});
		expect(await messagingIsDisabled('alice')).toBe(false);
	});
});

describe('setAcceptsDirectMessages', () => {
	// The rule that replaced `MessagingStandingNotYoursError`: the member's switch
	// is a different table from their standing, so "turn my messages back on"
	// structurally cannot clear a suspension. There is no guard to forget.
	it('writes the member’s own preference and nothing else', async () => {
		await setAcceptsDirectMessages('alice', false);
		expect(updated).toHaveLength(1);
		expect(updated[0].table).toBe('user');
		expect(updated[0].set).toEqual({ acceptsDirectMessages: false });
		expect(inserted).toHaveLength(0);
	});

	it('lets a restricted member still set their own switch', async () => {
		getStandingMock.mockResolvedValue({
			status: 'restricted',
			reason: 'harassment',
			triggeringFlagId: 'flag-1',
			updatedAt: null
		});
		await setAcceptsDirectMessages('alice', true);
		expect(updated[0].set).toEqual({ acceptsDirectMessages: true });
	});
});

describe('getMessagingState', () => {
	it('returns both halves separately, so the account page can show each for what it is', async () => {
		results = [[{ acceptsDirectMessages: false }]];
		getStandingMock.mockResolvedValue({
			status: 'restricted',
			reason: 'harassment',
			triggeringFlagId: 'flag-1',
			updatedAt: null
		});

		expect(await getMessagingState('alice')).toEqual({
			acceptsDirectMessages: false,
			standing: {
				status: 'restricted',
				reason: 'harassment',
				triggeringFlagId: 'flag-1',
				updatedAt: null
			}
		});
	});

	it('defaults to reachable when the row is missing', async () => {
		results = [[]];
		expect((await getMessagingState('ghost')).acceptsDirectMessages).toBe(true);
	});
});
