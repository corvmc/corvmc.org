import { describe, it, expect, vi, beforeEach } from 'vitest';

// portal-service is the boundary between a signed-in member and a shared staff
// inbox. Two invariants matter more than anything else it does:
//
//   1. Ownership is enforced in the WHERE clause, via a join on
//      inbox_participant. A guard in the SQL cannot be forgotten at one call site.
//   2. Nothing here reads inbox_note. Notes are staff-private annotations.
//
// A real SQLite, because a mocked `db` agrees with any WHERE.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit: vi.fn() } }));

const {
	getPortalThread,
	listPortalThreads,
	replyToPortalThread,
	startPortalConversation,
	markPortalThreadRead,
	countPortalUnread,
	MAX_OPEN_PORTAL_THREADS
} = await import('./portal-service');

const T0 = 1_750_000_000;

function thread(id: string, opts: { channel?: string; status?: string; lastAt?: number } = {}) {
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, status, subject, last_message_at, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.channel ?? 'portal',
			opts.status ?? 'open',
			`Subject ${id}`,
			opts.lastAt ?? T0,
			T0,
			T0
		);
}

function participant(threadId: string, userId: string, lastReadAt: number | null = null) {
	sqlite
		.prepare(
			`insert into inbox_participant (id, thread_id, user_id, role, last_read_at) values (?, ?, ?, 'member', ?)`
		)
		.run(`p-${threadId}-${userId}`, threadId, userId, lastReadAt);
}

function message(id: string, threadId: string, authorUserId: string | null, at: number) {
	sqlite
		.prepare(
			`insert into inbox_message (id, thread_id, direction, body, author_name, author_user_id, created_at)
			 values (?, ?, 'inbound', ?, ?, ?, ?)`
		)
		.run(id, threadId, `body ${id}`, `name ${authorUserId}`, authorUserId, at);
}

const threadRow = (id: string) =>
	sqlite.prepare('select status from inbox_thread where id = ?').get(id) as { status: string };
const lastReadAt = (threadId: string, userId: string) =>
	(
		sqlite
			.prepare('select last_read_at from inbox_participant where thread_id = ? and user_id = ?')
			.get(threadId, userId) as { last_read_at: number | null }
	).last_read_at;
const messagesOn = (threadId: string) =>
	sqlite.prepare('select author_user_id from inbox_message where thread_id = ?').all(threadId) as {
		author_user_id: string | null;
	}[];

beforeEach(() => {
	for (const t of ['inbox_note', 'inbox_message', 'inbox_participant', 'inbox_thread']) {
		sqlite.exec(`delete from ${t}`);
	}
});

describe('getPortalThread', () => {
	it('never returns inbox_note content', async () => {
		thread('t1');
		participant('t1', 'member-1');
		message('m1', 't1', 'member-1', T0);
		sqlite.exec(
			`insert into inbox_note (id, thread_id, author_user_id, body) values ('n1', 't1', 'staff-9', 'STAFF-ONLY')`
		);

		const result = await getPortalThread('t1', 'member-1');

		expect(result?.messages).toHaveLength(1);
		expect(JSON.stringify(result)).not.toContain('STAFF-ONLY');
	});

	it('returns null for a thread the caller does not participate in', async () => {
		thread('t1');
		participant('t1', 'member-2');

		expect(await getPortalThread('t1', 'member-1')).toBeNull();
	});

	it('returns null for a non-portal thread, even with the caller on it', async () => {
		thread('t1', { channel: 'email' });
		participant('t1', 'member-1');

		expect(await getPortalThread('t1', 'member-1')).toBeNull();
	});

	it('echoes the viewer id back', async () => {
		// The detail page orients its timeline off this. Without it the page has to
		// await a second query for the reader's identity, and awaiting
		// getMemberLayout() there deadlocks (effect_update_depth_exceeded).
		thread('t1');
		participant('t1', 'member-1');

		expect((await getPortalThread('t1', 'member-1'))?.viewerUserId).toBe('member-1');
	});

	it('masks other people’s author ids so no staff id reaches the client', async () => {
		thread('t1');
		participant('t1', 'member-1');
		message('m1', 't1', 'member-1', T0);
		message('m2', 't1', 'staff-9', T0 + 1);

		const result = await getPortalThread('t1', 'member-1');

		expect(result?.messages.map((m) => m.authorUserId)).toEqual(['member-1', null]);
		// The staff member's name is still shown — only the id is withheld.
		expect(result?.messages[1].authorName).toBe('name staff-9');
	});
});

describe('listPortalThreads', () => {
	it('scopes the list to the caller and the portal channel', async () => {
		thread('mine');
		participant('mine', 'member-1');
		thread('theirs');
		participant('theirs', 'member-2');
		thread('email', { channel: 'email' });
		participant('email', 'member-1');

		const result = await listPortalThreads('member-1', { page: 1 });

		expect(result.rows.map((r) => r.id)).toEqual(['mine']);
	});

	it('maps the unread flag to a boolean', async () => {
		thread('read', { lastAt: T0 });
		participant('read', 'member-1', T0 + 10);
		thread('unread', { lastAt: T0 + 20 });
		participant('unread', 'member-1', T0 + 10);
		thread('never', { lastAt: T0 });
		participant('never', 'member-1', null);

		const result = await listPortalThreads('member-1', { page: 1 });
		const unread = Object.fromEntries(result.rows.map((r) => [r.id, r.unread]));

		expect(unread).toEqual({ read: false, unread: true, never: true });
		expect(await countPortalUnread('member-1')).toBe(2);
	});
});

describe('replyToPortalThread', () => {
	const reply = { threadId: 't1', userId: 'member-1', userName: 'Robin', body: 'thanks' };

	it.each([
		['not yours', () => (thread('t1'), participant('t1', 'member-2'))],
		[
			'not a portal thread',
			() => (thread('t1', { channel: 'email' }), participant('t1', 'member-1'))
		],
		['resolved', () => (thread('t1', { status: 'resolved' }), participant('t1', 'member-1'))],
		['missing', () => undefined]
	])('writes nothing when the thread is %s', async (_label, seed) => {
		seed();

		expect(await replyToPortalThread(reply)).toBeNull();
		expect(messagesOn('t1')).toEqual([]);
	});

	it('attributes the message to the member and marks it read', async () => {
		thread('t1');
		participant('t1', 'member-1', null);

		const result = await replyToPortalThread(reply);

		expect(result?.messageId).toEqual(expect.any(String));
		expect(messagesOn('t1')).toEqual([{ author_user_id: 'member-1' }]);
		// Their own message must not come back to them as unread.
		expect(lastReadAt('t1', 'member-1')).not.toBeNull();
	});

	it('wakes a snoozed thread rather than leaving it parked', async () => {
		thread('t1', { status: 'snoozed' });
		participant('t1', 'member-1');

		await replyToPortalThread(reply);

		expect(threadRow('t1').status).toBe('open');
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
		const result = await startPortalConversation(start);

		expect(result).not.toBeNull();
		const created = sqlite
			.prepare('select channel, subject from inbox_thread where id = ?')
			.get(result!.threadId);
		expect(created).toEqual({ channel: 'portal', subject: 'Locker rental' });
		expect(lastReadAt(result!.threadId, 'member-1')).not.toBeNull();
		expect(messagesOn(result!.threadId)).toEqual([{ author_user_id: 'member-1' }]);
	});

	it('refuses once the member is at the open-conversation cap', async () => {
		for (let i = 0; i < MAX_OPEN_PORTAL_THREADS; i++) {
			thread(`t${i}`, { status: i % 2 ? 'snoozed' : 'open' });
			participant(`t${i}`, 'member-1');
		}

		expect(await startPortalConversation(start)).toBeNull();
		expect(sqlite.prepare('select count(*) as n from inbox_thread').get()).toEqual({
			n: MAX_OPEN_PORTAL_THREADS
		});
	});

	it('does not count resolved or other members’ threads toward the cap', async () => {
		for (let i = 0; i < MAX_OPEN_PORTAL_THREADS; i++) {
			thread(`r${i}`, { status: 'resolved' });
			participant(`r${i}`, 'member-1');
			thread(`o${i}`);
			participant(`o${i}`, 'member-2');
		}

		expect(await startPortalConversation(start)).not.toBeNull();
	});
});

describe('markPortalThreadRead', () => {
	it('can only move the caller’s own cursor', async () => {
		thread('t1');
		participant('t1', 'member-1', null);
		participant('t1', 'member-2', null);

		await markPortalThreadRead('t1', 'member-1');

		expect(lastReadAt('t1', 'member-1')).not.toBeNull();
		expect(lastReadAt('t1', 'member-2')).toBeNull();
	});
});
