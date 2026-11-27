import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The daily in-app digest (#3409), against a real SQLite: which held rows go in
 * is a WHERE clause over `data`, and the day latch is a unique index. Rows are
 * inserted raw, as the dispatcher writes them, so the pass does not care which
 * code path held them.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { sendInAppDigest, IN_APP_DIGEST_KEY } = await import('./digest');
const { getForUser, getUnreadCount, markRead, markAllRead } = await import('./in-app-service');

// 9:30am PDT: the digest is owed on the first pass of the day.
const NOW = new Date('2031-05-01T16:30:00Z');
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const now = sec(NOW);
const HOUR = 3600;
const exec = (q: string) => sqlite.exec(q);

function row(
	id: string,
	userId: string,
	over: { createdAt?: number; held?: boolean; read?: boolean; type?: string; href?: string } = {}
) {
	const data = over.held === false ? 'null' : `'{"heldForDigest":true}'`;
	exec(`insert into notification (id, user_id, type, title, href, data, read_at, created_at)
		values ('${id}', '${userId}', '${over.type ?? 'task_assigned'}', 'Title ${id}',
			${over.href ? `'${over.href}'` : 'null'}, ${data},
			${over.read ? now : 'null'}, ${over.createdAt ?? now - HOUR})`);
}

type Summary = {
	user_id: string;
	body: string;
	data: { ids: string[]; items: { title: string; href: string | null }[]; count: number };
};
function summaries(): Summary[] {
	return (
		sqlite
			.prepare(
				`select user_id, body, data from notification where type = 'notification_digest' order by user_id`
			)
			.all() as { user_id: string; body: string; data: string }[]
	).map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

beforeEach(() => {
	for (const t of ['reminder_sent', 'notification', '"user"']) exec(`delete from ${t}`);
	exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values
		('ana', 'Ana Lee', 'ana@example.test', 1, ${now}, ${now}),
		('ben', 'Ben Ode', 'ben@example.test', 1, ${now}, ${now})`);
});

describe('sendInAppDigest', () => {
	it('is not due before 9am club time', async () => {
		row('h1', 'ana');

		// 8:59am PDT.
		expect((await sendInAppDigest(new Date('2031-05-01T15:59:00Z'))).due).toBe(false);

		expect(summaries()).toEqual([]);
		expect(sqlite.prepare(`select count(*) c from reminder_sent`).get()).toEqual({ c: 0 });
	});

	it('writes one summary per member with held notices, newest first', async () => {
		row('h1', 'ana', { createdAt: now - 3 * HOUR, href: '/member/tasks' });
		row('h2', 'ana', { createdAt: now - 2 * HOUR });
		row('h3', 'ben');

		const result = await sendInAppDigest(NOW);

		expect(result).toEqual({ due: true, members: 2, held: 3 });
		const [ana, ben] = summaries();
		expect(ana.data.ids).toEqual(['h2', 'h1']);
		expect(ana.data.count).toBe(2);
		expect(ana.data.items).toEqual([
			{ title: 'Title h2', href: null },
			{ title: 'Title h1', href: '/member/tasks' }
		]);
		expect(ben.data.ids).toEqual(['h3']);
	});

	it('names the first eight and counts the rest', async () => {
		for (let i = 0; i < 10; i++) row(`h${i}`, 'ana', { createdAt: now - HOUR - i });

		await sendInAppDigest(NOW);

		const [ana] = summaries();
		expect(ana.data.items).toHaveLength(8);
		expect(ana.data.ids).toHaveLength(10);
		expect(ana.data.count).toBe(10);
	});

	it('leaves out notices that are not held, are already read, or are summaries', async () => {
		row('shown', 'ana', { held: false });
		row('read', 'ana', { read: true });
		row('old-digest', 'ana', { held: false, type: 'notification_digest' });

		const result = await sendInAppDigest(NOW);

		expect(result.members).toBe(0);
		expect(summaries()).toHaveLength(1);
	});

	it('writes nothing on a second pass the same day', async () => {
		row('h1', 'ana');
		await sendInAppDigest(NOW);

		const again = await sendInAppDigest(new Date(NOW.getTime() + 2 * HOUR * 1000));

		expect(again.due).toBe(false);
		expect(summaries()).toHaveLength(1);
	});

	it('sends a notice held after the pass in tomorrow’s digest', async () => {
		row('h1', 'ana');
		await sendInAppDigest(NOW);
		row('late', 'ana', { createdAt: now + HOUR });

		await sendInAppDigest(new Date('2031-05-02T16:30:00Z'));

		const ids = summaries().map((s) => s.data.ids);
		expect(ids).toHaveLength(2);
		expect(ids).toContainEqual(['h1']);
		expect(ids).toContainEqual(['late']);
	});

	it('does not repeat a notice in the next day’s digest', async () => {
		row('h1', 'ana');
		await sendInAppDigest(NOW);

		const next = await sendInAppDigest(new Date('2031-05-02T16:30:00Z'));

		expect(next).toEqual({ due: true, members: 0, held: 0 });
		expect(summaries()).toHaveLength(1);
	});

	it('stamps the day when nothing is held', async () => {
		expect(await sendInAppDigest(NOW)).toEqual({ due: true, members: 0, held: 0 });

		expect(
			sqlite
				.prepare(`select subject_id from reminder_sent where reminder_key = ?`)
				.all(IN_APP_DIGEST_KEY)
		).toEqual([{ subject_id: '2031-05-01' }]);
	});
});

describe('held notices and the bell', () => {
	it('hides held rows from the list and the unread count', async () => {
		row('held', 'ana');
		row('shown', 'ana', { held: false });

		expect((await getForUser('ana')).map((n) => n.id)).toEqual(['shown']);
		expect(await getUnreadCount('ana')).toBe(1);
	});

	it('marks the listed notices read when the summary is read', async () => {
		row('h1', 'ana');
		row('h2', 'ana');
		await sendInAppDigest(NOW);
		row('later', 'ana', { createdAt: now + HOUR });
		const summaryId = (
			sqlite.prepare(`select id from notification where type = 'notification_digest'`).get() as {
				id: string;
			}
		).id;

		await markRead(summaryId, 'ana');

		const read = sqlite.prepare(`select id from notification where read_at is not null`).all();
		expect(read.map((r) => (r as { id: string }).id).sort()).toEqual(
			['h1', 'h2', summaryId].sort()
		);
	});

	it('does not let one member read another’s summary', async () => {
		row('h1', 'ana');
		await sendInAppDigest(NOW);
		const summaryId = (
			sqlite.prepare(`select id from notification where type = 'notification_digest'`).get() as {
				id: string;
			}
		).id;

		await markRead(summaryId, 'ben');

		expect(sqlite.prepare(`select read_at from notification where id = 'h1'`).get()).toEqual({
			read_at: null
		});
	});

	it('leaves held notices unread on mark all read until their summary is read', async () => {
		row('h1', 'ana', { createdAt: now - HOUR });
		row('shown', 'ana', { held: false });
		await sendInAppDigest(NOW);
		row('later', 'ana', { createdAt: now + HOUR });

		await markAllRead('ana');

		const unread = (
			sqlite.prepare(`select id from notification where read_at is null`).all() as { id: string }[]
		).map((r) => r.id);
		expect(unread).toEqual(['later']);
	});
});
