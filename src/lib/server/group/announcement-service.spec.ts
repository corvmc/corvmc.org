import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Announcements against a real SQLite (#2618). A draft is a `group_announcement`
 * row; publishing posts it as one message in the group's single Announcements
 * thread. The rules worth pinning are `WHERE` clauses and the unique index, which
 * a mocked `db` would agree with either way. `renderMarkdown` is real too: it is
 * the one part of `shape()` that can be wrong in a way that matters (XSS).
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const handle = migratedSqlite({ foreignKeys: true });
	return { sqlite: handle.sqlite, testDb: withBatch(handle) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const svc = await import('./announcement-service');
const { getOrCreateGroupChat } = await import('#lib/server/inbox/group-chat-service.js');

const all = <T>(sql: string, ...args: unknown[]) => sqlite.prepare(sql).all(...args) as T[];
const announcementThreads = (groupId = 'g1') =>
	all<{ id: string; subject: string; message_count: number; preview: string | null }>(
		`select id, subject, message_count, preview from inbox_thread
		 where group_id = ? and post_policy = 'leadership'`,
		groupId
	);
const messagesIn = (threadId: string) =>
	all<{ id: string; body: string }>(
		`select id, body from inbox_message where thread_id = ? order by created_at, id`,
		threadId
	);

beforeEach(() => {
	for (const t of [
		'group_announcement',
		'inbox_group_read',
		'inbox_message',
		'inbox_thread',
		'group_member',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`insert into user (id, name, email) values
	  ('chair', 'Ada Chair', 'chair@example.com'), ('u2', 'Bo', 'bo@example.com'),
	  ('u3', 'Cy', 'cy@example.com')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug) values
	  ('g1', 'club', 'Real Book Club', 'rbc'), ('g2', 'band', 'Church Ladies', 'cl')`);
	sqlite.exec(`insert into group_member (id, group_id, user_id, role, status) values
	  ('m1', 'g1', 'chair', 'admin', 'active'), ('m2', 'g1', 'u2', 'member', 'active'),
	  ('m3', 'g1', 'u3', 'member', 'active')`);
});

const draft = (title = 'Week one', body = 'Tunes for **week one**', groupId = 'g1') =>
	svc.create(groupId, 'chair', { title, body });

describe('drafts', () => {
	it('writes a row and no thread', async () => {
		const post = await draft();

		expect(post).toMatchObject({ title: 'Week one', publishedAt: null, pinned: false });
		expect(post.author?.id).toBe('chair');
		expect(announcementThreads()).toEqual([]);
	});

	it('stays off the member list and on the manager list', async () => {
		const kept = await draft('Kept');
		await svc.publish(kept.id, 'g1');
		await draft('Unsent');
		await draft('Elsewhere', 'body', 'g2');

		expect((await svc.listPublished('g1')).map((p) => p.title)).toEqual(['Kept']);
		expect((await svc.listForManager('g1')).map((p) => p.title).sort()).toEqual(['Kept', 'Unsent']);
	});

	it('is reachable only through its own group', async () => {
		const post = await draft();
		await expect(svc.getById(post.id, 'g2')).rejects.toBeInstanceOf(svc.AnnouncementNotFoundError);
		await expect(svc.update(post.id, 'g2', { title: 'x' })).rejects.toBeInstanceOf(
			svc.AnnouncementNotFoundError
		);
	});
});

describe('publish', () => {
	// The class #2618 closes: every post used to open a thread of its own.
	it('posts every announcement into the one Announcements thread, title first', async () => {
		// A week apart, as the club posts them: the thread orders by `created_at`.
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			for (const [i, title] of ['Week one', 'Week two', 'Week three'].entries()) {
				vi.setSystemTime(new Date(Date.UTC(2026, 9, 1 + 7 * i)));
				const post = await draft(title, `Tunes for ${title}`);
				await svc.publish(post.id, 'g1');
			}
		} finally {
			vi.useRealTimers();
		}

		const [thread] = announcementThreads();
		expect(announcementThreads()).toHaveLength(1);
		expect(thread).toMatchObject({ subject: 'Announcements', message_count: 3 });
		expect(messagesIn(thread.id).map((m) => m.body)).toEqual([
			'Week one\n\nTunes for Week one',
			'Week two\n\nTunes for Week two',
			'Week three\n\nTunes for Week three'
		]);
	});

	it('keeps the group’s General chat separate', async () => {
		const general = await getOrCreateGroupChat('g1');
		const post = await draft();
		await svc.publish(post.id, 'g1');

		expect(announcementThreads()[0].id).not.toBe(general);
		expect(messagesIn(general)).toEqual([]);
	});

	it('gives each group its own Announcements thread', async () => {
		await svc.publish((await draft('A')).id, 'g1');
		await svc.publish((await draft('B', 'b', 'g2')).id, 'g2');

		expect(announcementThreads('g1')).toHaveLength(1);
		expect(announcementThreads('g2')).toHaveLength(1);
	});

	it('tells an admin the post was already published, and posts nothing twice', async () => {
		const post = await draft();
		await svc.publish(post.id, 'g1');

		await expect(svc.publish(post.id, 'g1')).rejects.toBeInstanceOf(svc.AlreadyPublishedError);
		expect(announcementThreads()[0].message_count).toBe(1);
	});

	it('404s an id that is not this group’s', async () => {
		const post = await draft();
		await expect(svc.publish(post.id, 'g2')).rejects.toBeInstanceOf(svc.AnnouncementNotFoundError);
	});
});

describe('one Announcements thread per group', () => {
	it('settles a race on the unique index rather than opening a second thread', async () => {
		const ids = await Promise.all([
			svc.getOrCreateAnnouncementThread('g1'),
			svc.getOrCreateAnnouncementThread('g1')
		]);

		expect(new Set(ids).size).toBe(1);
		expect(announcementThreads()).toHaveLength(1);
	});

	it('refuses a second leadership thread written by any path', () => {
		const insert = (id: string) =>
			sqlite
				.prepare(
					`insert into inbox_thread (id, channel, group_id, status, subject, post_policy, notify_policy)
					 values (?, 'group', 'g1', 'open', ?, 'leadership', 'email')`
				)
				.run(id, id);

		insert('first');
		expect(() => insert('second')).toThrow(/UNIQUE/);
	});
});

describe('update', () => {
	it('edits the message a published post became', async () => {
		const post = await draft();
		await svc.publish(post.id, 'g1');

		await svc.update(post.id, 'g1', { title: 'Week one, corrected' });

		const [thread] = announcementThreads();
		expect(messagesIn(thread.id).map((m) => m.body)).toEqual([
			'Week one, corrected\n\nTunes for **week one**'
		]);
		expect(thread.message_count).toBe(1);
	});

	it('pins without touching the message', async () => {
		const post = await draft();
		await svc.update(post.id, 'g1', { pinned: true });
		expect((await svc.getById(post.id, 'g1')).pinned).toBe(true);
	});
});

describe('remove', () => {
	it('takes the post out of the thread and keeps the row', async () => {
		const first = await draft('First');
		await svc.publish(first.id, 'g1');
		const second = await draft('Second');
		await svc.publish(second.id, 'g1');

		await svc.remove(second.id, 'g1');

		const [thread] = announcementThreads();
		expect(messagesIn(thread.id).map((m) => m.body)).toEqual(['First\n\nTunes for **week one**']);
		expect(thread).toMatchObject({ message_count: 1, preview: 'First\n\nTunes for **week one**' });
		expect(
			all(`select deleted_at is not null as gone from group_announcement where id = ?`, second.id)
		).toEqual([{ gone: 1 }]);
		expect(await svc.listPublished('g1')).toHaveLength(1);
	});

	it('404s an id from another group', async () => {
		const post = await draft();
		await expect(svc.remove(post.id, 'g2')).rejects.toBeInstanceOf(svc.AnnouncementNotFoundError);
	});
});

describe('shape', () => {
	it('renders the body to sanitized HTML beside the markdown source', async () => {
		const post = await draft('Jam', 'The jam is **next** Thursday. <script>alert(1)</script>');

		expect(post.body).toContain('**next**');
		expect(post.bodyHtml).toContain('<strong>next</strong>');
		expect(post.bodyHtml).not.toContain('<script>');
		expect(post.bodyHtml).not.toContain('alert(1)');
	});

	it('reports no author once the account is gone', async () => {
		const post = await draft();
		sqlite.exec(`delete from user where id = 'chair'`);

		expect((await svc.getById(post.id, 'g1')).author).toBeNull();
	});
});

describe('the fan-out latch', () => {
	it('claims a post once', async () => {
		const post = await draft();
		await expect(svc.claimForNotification(post.id)).resolves.toBe(true);
		await expect(svc.claimForNotification(post.id)).resolves.toBe(false);
	});
});

describe('listRecipients', () => {
	it('drops the author and anyone who muted the Announcements thread', async () => {
		const thread = await svc.getOrCreateAnnouncementThread('g1');
		sqlite.exec(
			`insert into inbox_group_read (id, thread_id, user_id, muted) values ('r', '${thread}', 'u3', 1)`
		);

		const ids = (await svc.listRecipients('g1', 'chair', thread)).map((r) => r.userId);
		expect(ids).toEqual(['u2']);
	});

	it('excludes nobody extra when the group has no thread yet', async () => {
		const ids = (await svc.listRecipients('g1', 'chair')).map((r) => r.userId).sort();
		expect(ids).toEqual(['u2', 'u3']);
	});
});
