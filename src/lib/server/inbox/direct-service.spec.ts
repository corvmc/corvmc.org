import { describe, it, expect, vi, beforeEach } from 'vitest';

// The boundary around a member↔member conversation, against a real SQLite:
//   1. Every branch that silently drops a message returns the SAME value, so a
//      sender cannot tell a decline from an unopened request.
//   2. replyToDirectThread enforces ALL of its conditions — each is broken
//      alone below, against a thread that is otherwise writable.
//   3. getDirectThread does NOT hide the counterpart's authorUserId.
//   4. Nothing here reads inbox_note.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const emitted: [string, Record<string, unknown>][] = [];
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: {
		emit: (name: string, payload: Record<string, unknown>) => {
			emitted.push([name, payload]);
			return Promise.resolve();
		},
		on: vi.fn()
	}
}));

// KV is the outside service here.
const allowRateLimited = vi.fn(async () => true);
vi.mock('#lib/server/rate-limit.js', () => ({
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
const { MAX_PENDING_SENT_REQUESTS } = await import('#lib/config.js');

const T0 = 1_750_000_000;

/** A birth date, in epoch seconds, that makes its owner 16 whenever the suite runs. */
function minorBirthSeconds(): number {
	const d = new Date();
	d.setFullYear(d.getFullYear() - 16);
	return Math.floor(d.getTime() / 1000);
}

function member(
	id: string,
	opts: { accepts?: boolean; dob?: number | null; deleted?: boolean } = {}
) {
	sqlite
		.prepare(
			`insert into user (id, name, email, accepts_direct_messages, date_of_birth, deleted_at)
			 values (?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			`Name ${id}`,
			`${id}@example.com`,
			opts.accepts === false ? 0 : 1,
			opts.dob ?? null,
			opts.deleted ? T0 : null
		);
}

const block = (blocker: string, blocked: string) =>
	sqlite
		.prepare(`insert into user_block (id, blocker_user_id, blocked_user_id) values (?, ?, ?)`)
		.run(`b-${blocker}-${blocked}`, blocker, blocked);

const standing = (userId: string, status: 'restricted' | 'disabled', reason: string | null) =>
	sqlite
		.prepare(
			`insert into member_standing (user_id, scope, status, reason) values (?, 'messaging', ?, ?)`
		)
		.run(userId, status, reason);

/** A direct thread between two members, each accepted or not. */
function conversation(
	id: string,
	parties: Record<string, boolean>,
	opts: { status?: string; channel?: string; lastAt?: number } = {}
) {
	sqlite
		.prepare(`insert into inbox_thread (id, channel, status, last_message_at) values (?, ?, ?, ?)`)
		.run(id, opts.channel ?? 'direct', opts.status ?? 'open', opts.lastAt ?? T0);
	for (const [userId, accepted] of Object.entries(parties)) {
		sqlite
			.prepare(
				`insert into inbox_participant (id, thread_id, user_id, role, accepted_at) values (?, ?, ?, 'member', ?)`
			)
			.run(`p-${id}-${userId}`, id, userId, accepted ? T0 : null);
	}
}

const count = (table: string) =>
	(sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

beforeEach(() => {
	vi.clearAllMocks();
	emitted.length = 0;
	allowRateLimited.mockResolvedValue(true);
	for (const t of [
		'inbox_note',
		'inbox_message',
		'inbox_participant',
		'inbox_thread',
		'user_block',
		'member_standing',
		'directory_entry',
		'user'
	]) {
		sqlite.exec(`delete from "${t}"`);
	}
	member('alice');
});

const START = { senderId: 'alice', senderName: 'Alice', recipientId: 'bob', body: 'hi there' };

describe('startDirectThread — every silent drop looks identical', () => {
	// Assert the results are equal to *each other*: a future "helpful error"
	// change has to notice it is breaking something deliberate.
	const drops: [string, () => void][] = [
		['blocked by the recipient', () => (member('bob'), block('bob', 'alice'))],
		['blocking the recipient', () => (member('bob'), block('alice', 'bob'))],
		['unknown', () => undefined],
		['deleted', () => member('bob', { deleted: true })],
		[
			'hidden from the directory',
			() => {
				member('bob');
				sqlite.exec(
					`insert into directory_entry (id, user_id, name, visibility) values ('d1', 'bob', 'Bob', 'hidden')`
				);
			}
		],
		['switched off by staff', () => (member('bob'), standing('bob', 'disabled', 'harassment'))],
		// The member's own preference is deliberately indistinguishable from a
		// staff decision: telling them apart would leak one or the other.
		['switched off themselves', () => member('bob', { accepts: false })],
		// A sender who could tell this case apart would learn the recipient's age.
		['too young', () => member('bob', { dob: minorBirthSeconds() })]
	];

	it.each(drops)('drops a message to a recipient %s, writing nothing', async (_label, setup) => {
		setup();

		expect(await startDirectThread(START)).toEqual({ status: 'sent' });
		expect(count('inbox_thread')).toBe(0);
		expect(count('inbox_message')).toBe(0);
		expect(emitted).toEqual([]);
	});

	it('drops a self-addressed or empty message the same way', async () => {
		expect(await startDirectThread({ ...START, recipientId: 'alice' })).toEqual({ status: 'sent' });
		member('bob');
		expect(await startDirectThread({ ...START, body: '   ' })).toEqual({ status: 'sent' });
		expect(count('inbox_thread')).toBe(0);
	});
});

describe('startDirectThread — the branches that DO report back', () => {
	beforeEach(() => member('bob'));

	/**
	 * The sender side, which is where the two must NOT look alike: `restricted`
	 * carries a staff note and an implied appeal; `ineligible` does not, because
	 * nobody judged this member (#556).
	 */
	it('tells a sender under 18 they are ineligible, not restricted', async () => {
		sqlite
			.prepare('update user set date_of_birth = ? where id = ?')
			.run(minorBirthSeconds(), 'alice');

		expect(await startDirectThread(START)).toEqual({ status: 'ineligible' });
		expect(count('inbox_thread')).toBe(0);
	});

	it('stops a sender who switched their own messaging off, with no reason to give', async () => {
		sqlite.exec(`update user set accepts_direct_messages = 0 where id = 'alice'`);

		expect(await startDirectThread(START)).toEqual({ status: 'restricted', reason: null });
		expect(count('inbox_thread')).toBe(0);
	});

	it('tells a restricted sender why, quoting the staff note', async () => {
		standing('alice', 'restricted', 'harassment');

		expect(await startDirectThread(START)).toEqual({ status: 'restricted', reason: 'harassment' });
	});

	it('reports the pending-request cap before spending a rate-limit hit', async () => {
		// DB truth first, KV backstop second — the reverse would burn the sender's
		// daily allowance on a request that was never going to be created.
		for (let i = 0; i < MAX_PENDING_SENT_REQUESTS; i++) {
			member(`r${i}`);
			conversation(`pending-${i}`, { alice: true, [`r${i}`]: false });
		}

		expect(await startDirectThread(START)).toEqual({ status: 'too_many_pending' });
		expect(allowRateLimited).not.toHaveBeenCalled();
		expect(count('inbox_thread')).toBe(MAX_PENDING_SENT_REQUESTS);
	});

	it('does not count an answered or closed request toward the cap', async () => {
		for (let i = 0; i < MAX_PENDING_SENT_REQUESTS; i++) {
			member(`r${i}`);
			conversation(
				`done-${i}`,
				{ alice: true, [`r${i}`]: i % 2 === 0 },
				{
					status: i % 2 === 0 ? 'open' : 'resolved'
				}
			);
		}

		expect(await startDirectThread(START)).toEqual({ status: 'sent' });
		expect(count('inbox_thread')).toBe(MAX_PENDING_SENT_REQUESTS + 1);
	});

	it('reports being rate limited', async () => {
		allowRateLimited.mockResolvedValue(false);

		expect(await startDirectThread(START)).toEqual({ status: 'rate_limited' });
		expect(count('inbox_thread')).toBe(0);
	});
});

describe('startDirectThread — what a successful request writes', () => {
	beforeEach(async () => {
		member('bob');
		expect(await startDirectThread(START)).toEqual({ status: 'sent' });
	});

	it('opens one thread on the direct channel', () => {
		expect(sqlite.prepare('select channel, status from inbox_thread').all()).toEqual([
			{ channel: 'direct', status: 'open' }
		]);
	});

	it('stamps the sender as accepted and leaves the recipient null', () => {
		// That asymmetry IS the request mechanism.
		const rows = sqlite
			.prepare(
				'select user_id, accepted_at is not null as accepted from inbox_participant order by user_id'
			)
			.all();
		expect(rows).toEqual([
			{ user_id: 'alice', accepted: 1 },
			{ user_id: 'bob', accepted: 0 }
		]);
	});

	it('marks the sender as having read their own message', () => {
		const row = sqlite
			.prepare(`select last_read_at from inbox_participant where user_id = 'alice'`)
			.get() as { last_read_at: number | null };
		expect(row.last_read_at).not.toBeNull();
	});

	it('writes the message as a request, naming the recipient', () => {
		expect(sqlite.prepare('select author_user_id, body from inbox_message').all()).toEqual([
			{ author_user_id: 'alice', body: 'hi there' }
		]);
		expect(emitted[0]).toEqual([
			'inbox.direct_message',
			expect.objectContaining({ isRequest: true, recipientId: 'bob', senderId: 'alice' })
		]);
	});
});

describe('replyToDirectThread', () => {
	const reply = (body = 'yo') =>
		replyToDirectThread({ threadId: 't1', userId: 'alice', userName: 'Alice', body });

	beforeEach(() => member('bob'));

	it('sends on an accepted, open, unblocked conversation', async () => {
		conversation('t1', { alice: true, bob: true });

		expect(await reply()).toEqual({ messageId: expect.any(String) });
		expect(emitted[0][1]).toMatchObject({ recipientId: 'bob', isRequest: false });
	});

	// Each guard broken alone, against a thread that is otherwise writable — a
	// test asserting only "returned null" on an empty table would survive the
	// deletion of any one of them.
	it.each<[string, () => void]>([
		['the caller has not accepted', () => conversation('t1', { alice: false, bob: true })],
		['the counterpart has not accepted', () => conversation('t1', { alice: true, bob: false })],
		[
			'the thread is resolved',
			() => conversation('t1', { alice: true, bob: true }, { status: 'resolved' })
		],
		[
			'the thread is not direct',
			() => conversation('t1', { alice: true, bob: true }, { channel: 'portal' })
		],
		['the caller is not on it', () => conversation('t1', { carol: true, bob: true })],
		[
			'the caller blocked them',
			() => (conversation('t1', { alice: true, bob: true }), block('alice', 'bob'))
		],
		[
			'they blocked the caller',
			() => (conversation('t1', { alice: true, bob: true }), block('bob', 'alice'))
		],
		[
			'staff switched the counterpart off',
			() => (conversation('t1', { alice: true, bob: true }), standing('bob', 'disabled', null))
		],
		[
			'the counterpart switched themselves off',
			() => {
				conversation('t1', { alice: true, bob: true });
				sqlite.exec(`update user set accepts_direct_messages = 0 where id = 'bob'`);
			}
		],
		[
			// Also proves the age cutoff binds as a number: better-sqlite3, like D1,
			// refuses a Date bound into a raw `sql` fragment.
			'the counterpart is under 18',
			() => {
				conversation('t1', { alice: true, bob: true });
				sqlite
					.prepare('update user set date_of_birth = ? where id = ?')
					.run(minorBirthSeconds(), 'bob');
			}
		]
	])('returns null and writes nothing when %s', async (_label, setup) => {
		setup();

		expect(await reply()).toBeNull();
		expect(count('inbox_message')).toBe(0);
	});

	it('still lets a member with no date of birth through', async () => {
		// The `IS NOT NULL` guard: most members have given no date.
		conversation('t1', { alice: true, bob: true });
		expect(await reply()).not.toBeNull();
	});

	it('refuses an empty body', async () => {
		conversation('t1', { alice: true, bob: true });
		expect(await reply(' ')).toBeNull();
		expect(count('inbox_message')).toBe(0);
	});
});

describe('getDirectThread', () => {
	beforeEach(() => {
		member('bob');
		sqlite.exec(`insert into inbox_thread (id, channel, status) values ('t1', 'direct', 'open')`);
		sqlite.exec(
			`insert into inbox_message (id, thread_id, direction, body, author_user_id, created_at)
			 values ('m1', 't1', 'peer', 'hello', 'bob', ${T0})`
		);
		sqlite.exec(
			`insert into inbox_note (id, thread_id, author_user_id, body) values ('n1', 't1', 'staff-1', 'STAFF-ONLY')`
		);
	});
	const join = (userId: string, accepted: boolean) =>
		sqlite
			.prepare(
				`insert into inbox_participant (id, thread_id, user_id, role, accepted_at) values (?, 't1', ?, 'member', ?)`
			)
			.run(`p-${userId}`, userId, accepted ? T0 : null);

	it('never returns inbox_note content', async () => {
		join('alice', true);
		join('bob', true);

		expect(JSON.stringify(await getDirectThread('t1', 'alice'))).not.toContain('STAFF-ONLY');
	});

	it('does NOT mask the other member’s authorUserId', async () => {
		// The inverse of getPortalThread. Here the counterpart is another member,
		// and ThreadTimeline needs the id to pick a side for each bubble.
		join('alice', true);
		join('bob', true);

		const thread = await getDirectThread('t1', 'alice');
		expect(thread?.messages[0].authorUserId).toBe('bob');
		expect(thread?.counterpartId).toBe('bob');
	});

	it('serves a thread the caller has not accepted yet', async () => {
		// Report sits next to Accept and Decline on a request, and you can only
		// report what you can read.
		join('alice', false);
		join('bob', true);

		const thread = await getDirectThread('t1', 'alice');
		expect(thread?.accepted).toBe(false);
		expect(thread?.messages).toHaveLength(1);
	});

	it('returns null when the caller is not a participant', async () => {
		join('alice', true);
		join('bob', true);

		expect(await getDirectThread('t1', 'mallory')).toBeNull();
	});
});

describe('the unread count', () => {
	// A request shows in the Messages list, but never adds to the badge. If
	// either drifts, an unconsented message either follows the recipient around
	// the site or disappears from where they would look for it.
	beforeEach(() => {
		member('bob');
		member('carol');
		conversation('request', { alice: false, bob: true }, { lastAt: T0 });
		conversation('accepted', { alice: true, carol: true }, { lastAt: T0 + 1 });
	});

	it('countDirectUnread counts accepted threads only', async () => {
		expect(await countDirectUnread('alice')).toBe(1);
	});

	it('listDirectThreads lists requests too, tagged so the UI can mark them', async () => {
		const result = await listDirectThreads('alice', { page: 1, pageSize: 25 });

		expect(result.rows.map((r) => [r.id, r.pending])).toEqual([
			['accepted', false],
			['request', true]
		]);
	});
});

describe('declineDirectThread', () => {
	beforeEach(() => member('bob'));

	it('blocks the sender and closes the conversation, telling the decliner nothing more', async () => {
		conversation('t1', { alice: false, bob: true });

		// A bare boolean — no sender-facing payload.
		expect(await declineDirectThread('t1', 'alice')).toBe(true);
		expect(
			sqlite.prepare('select blocker_user_id, blocked_user_id, source from user_block').all()
		).toEqual([{ blocker_user_id: 'alice', blocked_user_id: 'bob', source: 'declined_request' }]);
		expect(sqlite.prepare(`select status from inbox_thread where id = 't1'`).get()).toEqual({
			status: 'resolved'
		});
	});

	it('does nothing when there is no pending request', async () => {
		conversation('t1', { alice: true, bob: true });

		expect(await declineDirectThread('t1', 'alice')).toBe(false);
		expect(count('user_block')).toBe(0);
	});
});

describe('acceptDirectThread', () => {
	beforeEach(() => {
		member('bob');
		conversation('t1', { alice: false, bob: true });
	});
	const accepted = () =>
		(
			sqlite
				.prepare(
					`select accepted_at from inbox_participant where thread_id = 't1' and user_id = 'alice'`
				)
				.get() as { accepted_at: number | null }
		).accepted_at;

	// Both halves of "switched off" refuse, whether staff did it or the member.
	it.each<[string, () => void]>([
		['staff switched them off', () => standing('alice', 'disabled', null)],
		[
			'they switched themselves off',
			() => sqlite.exec(`update user set accepts_direct_messages = 0 where id = 'alice'`)
		],
		['the two have a block between them', () => block('bob', 'alice')]
	])('refuses when %s', async (_label, setup) => {
		setup();

		expect(await acceptDirectThread('t1', 'alice')).toBe(false);
		expect(accepted()).toBeNull();
	});

	it('accepts an outstanding request, once', async () => {
		expect(await acceptDirectThread('t1', 'alice')).toBe(true);
		expect(accepted()).not.toBeNull();
		expect(await acceptDirectThread('t1', 'alice')).toBe(false);
	});
});
