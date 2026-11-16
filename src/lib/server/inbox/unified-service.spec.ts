import { describe, it, expect, vi, beforeEach } from 'vitest';

// The band Messages row's count (#3136), against a real SQLite: the answer is
// the WHERE clause, which a mocked `db` would agree with either way.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { countGroupInboxUnread } = await import('./unified-service');

const T0 = 1_750_000_000;

function thread(
	id: string,
	opts: { channel?: 'group' | 'band'; groupId?: string; status?: string; lastAt?: number } = {}
) {
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, group_id, status, last_message_at, subject) values (?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.channel ?? 'group',
			opts.groupId ?? 'g1',
			opts.status ?? 'open',
			opts.lastAt ?? T0,
			id
		);
}

function cursor(threadId: string, lastReadAt: number | null, muted = false) {
	sqlite
		.prepare(
			`insert into inbox_group_read (id, thread_id, user_id, last_read_at, muted) values (?, ?, 'u1', ?, ?)`
		)
		.run(`r-${threadId}`, threadId, lastReadAt, muted ? 1 : 0);
}

beforeEach(() => {
	for (const t of ['inbox_group_read', 'inbox_thread']) sqlite.exec(`delete from "${t}"`);
	sqlite.exec(
		`insert or ignore into user (id, name, email) values ('u1', 'Ada', 'u1@example.com')`
	);
});

describe('countGroupInboxUnread', () => {
	it('splits unread chat from unread enquiries', async () => {
		thread('chat-new');
		thread('enquiry-new', { channel: 'band' });
		thread('enquiry-2', { channel: 'band' });
		expect(await countGroupInboxUnread('u1', 'g1')).toEqual({ chat: 1, enquiries: 2 });
	});

	it('skips a thread read since its last message', async () => {
		thread('read', { lastAt: T0 });
		cursor('read', T0 + 10);
		thread('stale', { lastAt: T0 + 20 });
		cursor('stale', T0 + 10);
		expect(await countGroupInboxUnread('u1', 'g1')).toEqual({ chat: 1, enquiries: 0 });
	});

	it('skips a resolved enquiry, another group, and a muted room', async () => {
		thread('resolved', { channel: 'band', status: 'resolved' });
		thread('elsewhere', { groupId: 'g2' });
		thread('muted');
		cursor('muted', null, true);
		expect(await countGroupInboxUnread('u1', 'g1')).toEqual({ chat: 0, enquiries: 0 });
	});
});
