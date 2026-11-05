import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Blocks and reachability against a real SQLite, with the real standing service:
//   1. Blocks are directional rows read in both directions. Unblocking removes
//      only your own row — if the other person blocked you too, theirs stands.
//   2. Reachability has independent halves — a restriction (`member_standing`),
//      the member's own switch (`user.accepts_direct_messages`) and their age.
//      The member's switch cannot lift a restriction: they write different tables.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

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
const { sql } = await import('drizzle-orm');

const NOW = new Date('2026-06-15T12:00:00Z');
const T0 = 1_750_000_000;

/** A birth date `n` years before NOW, in epoch seconds. */
function yearsAgo(n: number): number {
	const d = new Date(NOW.getTime());
	d.setFullYear(d.getFullYear() - n);
	return d.getTime() / 1000;
}

function account(id: string, opts: { accepts?: boolean; dob?: number } = {}) {
	sqlite
		.prepare(
			`insert into user (id, name, email, accepts_direct_messages, date_of_birth) values (?, ?, ?, ?, ?)`
		)
		.run(id, id, `${id}@example.com`, opts.accepts === false ? 0 : 1, opts.dob ?? null);
}

function standing(userId: string, status: string, reason: string | null = null) {
	sqlite
		.prepare(
			`insert into member_standing (user_id, scope, status, reason, triggering_flag_id, updated_at)
			 values (?, 'messaging', ?, ?, 'flag-1', ?)`
		)
		.run(userId, status, reason, T0);
}

function block(blocker: string, blocked: string) {
	sqlite
		.prepare(`insert into user_block (blocker_user_id, blocked_user_id) values (?, ?)`)
		.run(blocker, blocked);
}

const blocks = () =>
	sqlite
		.prepare(
			'select blocker_user_id as blocker, blocked_user_id as blocked, source from user_block order by blocker'
		)
		.all() as { blocker: string; blocked: string; source: string }[];

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	for (const t of ['user_block', 'member_standing', 'user']) sqlite.exec(`delete from ${t}`);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('blockUser', () => {
	it('is idempotent — blocking twice writes one row', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'bob' });
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'bob' });
		expect(blocks()).toHaveLength(1);
	});

	it('records why, so staff have context without asking', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'bob', source: 'declined_request' });
		expect(blocks()[0].source).toBe('declined_request');
	});

	it('defaults to a manual block', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'bob' });
		expect(blocks()[0].source).toBe('manual');
	});

	it('refuses to let someone block themselves', async () => {
		await blockUser({ blockerUserId: 'alice', blockedUserId: 'alice' });
		expect(blocks()).toHaveLength(0);
	});
});

describe('unblockUser', () => {
	// Deleting "the pair" would let either party unilaterally reopen a channel
	// the other closed.
	it('removes only the caller’s own row', async () => {
		block('alice', 'bob');
		block('bob', 'alice');
		block('alice', 'carol');

		await unblockUser('alice', 'bob');

		expect(blocks().map((b) => `${b.blocker}>${b.blocked}`)).toEqual(['alice>carol', 'bob>alice']);
	});
});

describe('block checks read both directions', () => {
	// A check that only asks "did the sender block the recipient" lets a
	// blocked person keep writing to the person who blocked them.
	it('isBlockedEitherWay finds a block in either direction', async () => {
		block('bob', 'alice');
		expect(await isBlockedEitherWay('alice', 'bob')).toBe(true);
		expect(await isBlockedEitherWay('bob', 'alice')).toBe(true);
	});

	it('isBlockedEitherWay ignores blocks involving someone else', async () => {
		block('alice', 'carol');
		block('carol', 'bob');
		expect(await isBlockedEitherWay('alice', 'bob')).toBe(false);
	});

	it('blockExistsBetween matches either ordering and nothing else', async () => {
		block('bob', 'alice');
		block('alice', 'carol');
		const hit = (a: string, b: string) =>
			(testDb.get(sql`select ${blockExistsBetween(a, b)} as hit`) as { hit: number }).hit;

		expect(hit('alice', 'bob')).toBe(1);
		expect(hit('bob', 'alice')).toBe(1);
		expect(hit('bob', 'carol')).toBe(0);
	});
});

describe('canInitiateMessages', () => {
	// Their own switch stops people reaching them; it is not a finding against
	// them, so it does not close conversations they are already in.
	it('is about the restriction only — a member who switched themselves off may still reply', async () => {
		account('alice', { accepts: false });
		expect(await canInitiateMessages('alice')).toBe(true);
	});

	it('a restricted member may not start conversations', async () => {
		account('alice');
		standing('alice', 'restricted');
		expect(await canInitiateMessages('alice')).toBe(false);
	});

	// Nobody restricted this member, so there is no note to quote and nothing
	// to appeal (#556).
	it('a member under 18 may not start conversations either', async () => {
		account('alice', { dob: yearsAgo(16) });
		expect(await canInitiateMessages('alice')).toBe(false);
	});
});

describe('messagingIsDisabled — the three parts', () => {
	it('is true when staff switched messaging off', async () => {
		account('alice');
		standing('alice', 'disabled', 'continued messaging after being asked to stop');
		expect(await messagingIsDisabled('alice')).toBe(true);
	});

	it('is true when the member switched it off themselves', async () => {
		account('alice', { accepts: false });
		expect(await messagingIsDisabled('alice')).toBe(true);
	});

	it('is true for a member under 18 whose standing is good', async () => {
		account('alice', { dob: yearsAgo(16) });
		expect(await messagingIsDisabled('alice')).toBe(true);
	});

	it('is false for a member who has just turned 18', async () => {
		account('alice', { dob: yearsAgo(18) });
		expect(await messagingIsDisabled('alice')).toBe(false);
	});

	// One boolean: telling a sender which half produced it would leak either a
	// moderation decision or a personal preference.
	it('is false only when none of the three says so', async () => {
		account('alice');
		account('bob', { accepts: false });
		standing('bob', 'disabled');
		expect(await messagingIsDisabled('alice')).toBe(false);
	});

	// `restricted` is reply-only for the restricted member; others can still
	// write to them — that is what separates it from `disabled`.
	it('a report-driven restriction does not make someone unreachable', async () => {
		account('alice');
		standing('alice', 'restricted');
		expect(await messagingIsDisabled('alice')).toBe(false);
	});
});

describe('setAcceptsDirectMessages', () => {
	// The member's switch is a different table from their standing, so "turn my
	// messages back on" structurally cannot clear a suspension.
	it('writes the member’s own preference and nothing else', async () => {
		account('alice');
		account('bob');

		await setAcceptsDirectMessages('alice', false);

		expect(
			sqlite.prepare('select id, accepts_direct_messages as a from user order by id').all()
		).toEqual([
			{ id: 'alice', a: 0 },
			{ id: 'bob', a: 1 }
		]);
		expect(sqlite.prepare('select count(*) as n from member_standing').get()).toEqual({ n: 0 });
	});

	it('lets a restricted member set their own switch, and leaves the restriction standing', async () => {
		account('alice', { accepts: false });
		standing('alice', 'restricted', 'harassment');

		await setAcceptsDirectMessages('alice', true);

		const state = await getMessagingState('alice');
		expect(state.acceptsDirectMessages).toBe(true);
		expect(state.standing.status).toBe('restricted');
	});
});

describe('getMessagingState', () => {
	it('returns all three separately, so the account page can show each for what it is', async () => {
		account('alice', { accepts: false });
		standing('alice', 'restricted', 'harassment');

		expect(await getMessagingState('alice')).toEqual({
			acceptsDirectMessages: false,
			standing: {
				status: 'restricted',
				reason: 'harassment',
				triggeringFlagId: 'flag-1',
				updatedAt: new Date(T0 * 1000)
			},
			ageRestricted: false
		});
	});

	// #556 from the member's side: a 16-year-old must not be shown a staff note
	// or an appeal, because nobody decided anything about them.
	it('reports a minor as age-restricted, with their standing untouched', async () => {
		account('robin', { dob: yearsAgo(16) });

		const state = await getMessagingState('robin');
		expect(state.ageRestricted).toBe(true);
		expect(state.standing.status).toBe('none');
		expect(state.standing.reason).toBeNull();
	});

	it('defaults to reachable when the row is missing', async () => {
		expect((await getMessagingState('ghost')).acceptsDirectMessages).toBe(true);
	});

	it('does not restrict the members who have given no date, which is most of them', async () => {
		account('alice');
		expect((await getMessagingState('alice')).ageRestricted).toBe(false);
	});
});
