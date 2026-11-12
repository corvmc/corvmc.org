/**
 * The #2618 backfill: a group's announcement threads (one per post, #1304)
 * merge into one Announcements thread, drafts become `group_announcement`
 * rows, and the unique index that follows it then builds. Real SQLite over the
 * real migrations, stopped before the backfill so the legacy shape can exist.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const sqlOf = (name: string) =>
	readFileSync(globSync(`migrations/*_${name}/migration.sql`)[0], 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
const backfill = sqlOf('one_announcements_thread');
const index = sqlOf('one_announcements_thread_index');

const { sqlite } = migratedSqlite({ foreignKeys: true, through: 'group_announcement' });
const run = (statements: string[]) => statements.forEach((s) => sqlite.exec(s));

const T0 = 1_750_000_000;
const DAY = 86_400;

function thread(
	id: string,
	groupId: string,
	opts: { subject?: string | null; at: number; published?: boolean; deleted?: boolean }
) {
	const leadership = opts.subject !== null;
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, group_id, status, subject, post_policy, notify_policy,
			  published_at, notified_at, recipient_count, deleted_at, pinned, created_at, updated_at)
			 values (?, 'group', ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			groupId,
			opts.subject ?? null,
			leadership ? 'leadership' : 'members',
			leadership ? 'email' : 'in_app',
			opts.published ? opts.at : null,
			opts.published ? opts.at : null,
			opts.published ? 12 : null,
			opts.deleted ? opts.at + DAY : null,
			id === 'rbc-2' ? 1 : 0,
			opts.at,
			opts.at
		);
}

function message(id: string, threadId: string, body: string, at: number) {
	sqlite
		.prepare(
			`insert into inbox_message (id, thread_id, direction, body, author_name, author_user_id, created_at)
			 values (?, ?, 'peer', ?, 'Ada', 'u1', ?)`
		)
		.run(id, threadId, body, at);
}

beforeAll(() => {
	sqlite.exec(`insert into user (id, name, email) values ('u1', 'Ada', 'ada@example.com'),
	  ('u2', 'Bo', 'bo@example.com')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug) values
	  ('rbc', 'club', 'Real Book Club', 'rbc'), ('cl', 'band', 'Church Ladies', 'cl'),
	  ('drafty', 'club', 'Drafty', 'drafty')`);

	// Real Book Club: General, a named topic, three published posts (the
	// second pinned, the third with a reply), a withdrawn post and a draft.
	thread('rbc-general', 'rbc', { subject: null, at: T0 });
	thread('rbc-1', 'rbc', { subject: 'Week one', at: T0 + DAY, published: true });
	thread('rbc-2', 'rbc', { subject: 'Week two', at: T0 + 2 * DAY, published: true });
	thread('rbc-3', 'rbc', { subject: 'Week three', at: T0 + 3 * DAY, published: true });
	thread('rbc-gone', 'rbc', {
		subject: 'Withdrawn',
		at: T0 + 4 * DAY,
		published: true,
		deleted: true
	});
	thread('rbc-draft', 'rbc', { subject: 'Next week', at: T0 + 5 * DAY });
	message('m1', 'rbc-1', 'Tunes for week one', T0 + DAY);
	message('m2', 'rbc-2', 'Tunes for week two', T0 + 2 * DAY);
	message('m3', 'rbc-3', 'Tunes for week three', T0 + 3 * DAY);
	message('m3-reply', 'rbc-3', 'Bring a stand', T0 + 3 * DAY + 60);
	message('m-gone', 'rbc-gone', 'Never mind', T0 + 4 * DAY);
	message('m-draft', 'rbc-draft', 'Half written', T0 + 5 * DAY);
	sqlite.exec(`insert into inbox_group_read (id, thread_id, user_id, last_read_at) values
	  ('r1', 'rbc-1', 'u2', ${T0 + DAY}), ('r3', 'rbc-3', 'u2', ${T0 + 3 * DAY + 60}),
	  ('r-gone', 'rbc-gone', 'u2', ${T0 + 4 * DAY})`);

	// Church Ladies has only General; Drafty has only a draft.
	thread('cl-general', 'cl', { subject: null, at: T0 });
	thread('drafty-draft', 'drafty', { subject: 'Plan', at: T0 });
	message('m-drafty', 'drafty-draft', 'Plan body', T0);

	run(backfill);
	run(index);
});

afterAll(() => sqlite.close());

const all = <T>(sql: string, ...args: unknown[]) => sqlite.prepare(sql).all(...args) as T[];
const announcementThreads = (groupId: string) =>
	all<{ id: string; subject: string; message_count: number; published_at: number | null }>(
		`select id, subject, message_count, published_at from inbox_thread
		 where group_id = ? and post_policy = 'leadership'`,
		groupId
	);

describe('one announcements thread backfill', () => {
	it('merges a group’s published posts into its oldest post’s thread', () => {
		expect(announcementThreads('rbc')).toEqual([
			{ id: 'rbc-1', subject: 'Announcements', message_count: 4, published_at: null }
		]);
		const bodies = all<{ id: string; body: string }>(
			`select id, body from inbox_message where thread_id = 'rbc-1' order by created_at, id`
		);
		expect(bodies).toEqual([
			{ id: 'm1', body: 'Week one\n\nTunes for week one' },
			{ id: 'm2', body: 'Week two\n\nTunes for week two' },
			{ id: 'm3', body: 'Week three\n\nTunes for week three' },
			{ id: 'm3-reply', body: 'Bring a stand' }
		]);
	});

	it('keeps every announcement as a row with its title, state and post', () => {
		const rows = all<Record<string, unknown>>(
			`select id, title, body, published_at is not null as published, message_id, pinned,
			   deleted_at is not null as deleted, recipient_count, notified_at is not null as notified
			 from group_announcement where group_id = 'rbc' order by id`
		);
		expect(rows).toEqual([
			{
				id: 'rbc-1',
				title: 'Week one',
				body: 'Tunes for week one',
				published: 1,
				message_id: 'm1',
				pinned: 0,
				deleted: 0,
				recipient_count: 12,
				notified: 1
			},
			{
				id: 'rbc-2',
				title: 'Week two',
				body: 'Tunes for week two',
				published: 1,
				message_id: 'm2',
				pinned: 1,
				deleted: 0,
				recipient_count: 12,
				notified: 1
			},
			{
				id: 'rbc-3',
				title: 'Week three',
				body: 'Tunes for week three',
				published: 1,
				message_id: 'm3',
				pinned: 0,
				deleted: 0,
				recipient_count: 12,
				notified: 1
			},
			{
				id: 'rbc-draft',
				title: 'Next week',
				body: 'Half written',
				published: 0,
				message_id: null,
				pinned: 0,
				deleted: 0,
				recipient_count: null,
				notified: 0
			},
			{
				id: 'rbc-gone',
				title: 'Withdrawn',
				body: 'Never mind',
				published: 1,
				message_id: null,
				pinned: 0,
				deleted: 1,
				recipient_count: 12,
				notified: 1
			}
		]);
	});

	it('deletes the emptied threads and their read state', () => {
		const left = all<{ id: string }>(`select id from inbox_thread order by id`).map((r) => r.id);
		expect(left).toEqual(['cl-general', 'rbc-1', 'rbc-general']);
		expect(
			all(`select id from inbox_message where id in ('m-gone', 'm-draft', 'm-drafty')`)
		).toEqual([]);
		expect(
			all<{ thread_id: string }>(`select thread_id from inbox_group_read where user_id = 'u2'`)
		).toEqual([{ thread_id: 'rbc-1' }]);
	});

	it('carries a reader’s furthest cursor to the merged thread', () => {
		const [cursor] = all<{ last_read_at: number }>(
			`select last_read_at from inbox_group_read where thread_id = 'rbc-1' and user_id = 'u2'`
		);
		expect(cursor.last_read_at).toBe(T0 + 4 * DAY);
	});

	it('turns a group with only drafts into drafts and no thread', () => {
		expect(announcementThreads('drafty')).toEqual([]);
		expect(all(`select id, title, body from group_announcement where group_id = 'drafty'`)).toEqual(
			[{ id: 'drafty-draft', title: 'Plan', body: 'Plan body' }]
		);
	});

	it('changes nothing on a second run', () => {
		const snapshot = () => ({
			threads: all(`select * from inbox_thread order by id`),
			messages: all(`select * from inbox_message order by id`),
			announcements: all(`select * from group_announcement order by id`),
			reads: all(
				`select thread_id, user_id, last_read_at from inbox_group_read order by thread_id, user_id`
			)
		});
		const before = snapshot();
		run(backfill);
		expect(snapshot()).toEqual(before);
	});

	it('refuses a second announcements thread once the index exists', () => {
		expect(() =>
			thread('rbc-again', 'rbc', { subject: 'Announcements', at: T0 + 9 * DAY })
		).toThrow(/UNIQUE/);
	});
});
