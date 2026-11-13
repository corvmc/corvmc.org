/**
 * The #2621 backfill: a group's duplicate General threads merge into its
 * oldest, and the unique index that follows it then builds. Real SQLite over
 * the real migrations, stopped before the backfill so duplicates can exist.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const sqlOf = (name: string) =>
	readFileSync(globSync(`migrations/*_${name}/migration.sql`)[0], 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
const backfill = sqlOf('one_general_chat');
const index = sqlOf('one_general_chat_index');

const { sqlite } = migratedSqlite({ foreignKeys: true, through: 'one_announcements_thread_index' });
const run = (statements: string[]) => statements.forEach((s) => sqlite.exec(s));

const T0 = 1_750_000_000;

function thread(id: string, groupId: string, at: number, subject: string | null = null) {
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, group_id, status, subject, created_at, updated_at)
			 values (?, 'group', ?, 'open', ?, ?, ?)`
		)
		.run(id, groupId, subject, at, at);
}

function message(id: string, threadId: string, body: string, at: number) {
	sqlite
		.prepare(
			`insert into inbox_message (id, thread_id, direction, body, author_name, author_user_id, created_at)
			 values (?, ?, 'peer', ?, 'Ada', 'u1', ?)`
		)
		.run(id, threadId, body, at);
}

function cursor(threadId: string, userId: string, lastReadAt: number | null, muted = 0) {
	sqlite
		.prepare(
			`insert into inbox_group_read (id, thread_id, user_id, last_read_at, muted) values (?, ?, ?, ?, ?)`
		)
		.run(`r-${threadId}-${userId}`, threadId, userId, lastReadAt, muted);
}

const rows = <T>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).all(...params) as T[];

beforeAll(() => {
	sqlite.exec(`insert into user (id, name, email) values ('u1', 'Ada', 'ada@example.com'),
	  ('u2', 'Bo', 'bo@example.com'), ('u3', 'Cy', 'cy@example.com')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug) values
	  ('dup', 'band', 'Dup', 'dup'), ('one', 'band', 'One', 'one')`);

	// Dup: two Generals from a race, plus a named topic that must be left alone.
	thread('dup-a', 'dup', T0);
	thread('dup-b', 'dup', T0 + 1);
	thread('dup-topic', 'dup', T0 + 2, 'Tour');
	message('m1', 'dup-a', 'first', T0 + 10);
	message('m2', 'dup-b', 'second', T0 + 20);
	message('m3', 'dup-topic', 'tour talk', T0 + 30);
	cursor('dup-a', 'u1', T0 + 10);
	cursor('dup-b', 'u1', T0 + 20);
	cursor('dup-b', 'u2', T0 + 20, 1);
	cursor('dup-a', 'u3', null);
	cursor('dup-b', 'u3', T0 + 5);

	// One: a single General, already right.
	thread('one-a', 'one', T0);
	message('m4', 'one-a', 'hello', T0 + 40);

	run(backfill);
});

describe('one General chat per group', () => {
	it('keeps the oldest General and drops the rest', () => {
		expect(
			rows<{ id: string }>(
				`select id from inbox_thread where channel = 'group' and subject is null order by id`
			).map((r) => r.id)
		).toEqual(['dup-a', 'one-a']);
	});

	it('moves every message into the kept thread and leaves topics alone', () => {
		expect(
			rows<{ id: string; thread_id: string }>(`select id, thread_id from inbox_message order by id`)
		).toEqual([
			{ id: 'm1', thread_id: 'dup-a' },
			{ id: 'm2', thread_id: 'dup-a' },
			{ id: 'm3', thread_id: 'dup-topic' },
			{ id: 'm4', thread_id: 'one-a' }
		]);
	});

	it('keeps each reader’s furthest cursor and any mute', () => {
		expect(
			rows(
				`select user_id, last_read_at, muted from inbox_group_read where thread_id = 'dup-a' order by user_id`
			)
		).toEqual([
			{ user_id: 'u1', last_read_at: T0 + 20, muted: 0 },
			{ user_id: 'u2', last_read_at: T0 + 20, muted: 1 },
			{ user_id: 'u3', last_read_at: T0 + 5, muted: 0 }
		]);
		expect(rows(`select id from inbox_group_read where thread_id = 'dup-b'`)).toEqual([]);
	});

	it('recounts the kept thread from what it now holds', () => {
		expect(
			rows(
				`select id, message_count, last_message_at, preview from inbox_thread where id in ('dup-a', 'one-a') order by id`
			)
		).toEqual([
			{ id: 'dup-a', message_count: 2, last_message_at: T0 + 20, preview: 'second' },
			{ id: 'one-a', message_count: 1, last_message_at: T0 + 40, preview: 'hello' }
		]);
	});

	it('leaves the unique index able to build, and a second run changes nothing', () => {
		const before = rows(`select * from inbox_group_read order by id`);
		run(backfill);
		expect(rows(`select * from inbox_group_read order by id`)).toEqual(before);
		expect(() => run(index)).not.toThrow();
	});
});
