import { describe, it, expect, vi, beforeEach } from 'vitest';

// The staff queue must never show a member↔member conversation — nor a band's
// booking queue or a group's own room — unless it has been reported. That rule
// lives in one exported predicate, `staffVisibleThread`, and in a one-line
// refusal at the top of getThread(). Both are easy to lose by accident, so
// these run every reader against a real SQLite holding a thread on each channel.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const {
	listThreads,
	getThread,
	getUnresolvedCount,
	countThreadsByStatus,
	listThreadsByContactEmail
} = await import('./thread-service');

const EMAIL = 'someone@example.com';
const PRIVATE = ['direct', 'band', 'group'] as const;

function thread(id: string, channel: string) {
	// Every thread carries the same address and a searchable preview, so a
	// reader that dropped the predicate would have something to return.
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, status, subject, preview, contact_email, last_message_at)
			 values (?, ?, 'open', 'hello', 'hello there', ?, 1750000000)`
		)
		.run(id, channel, EMAIL);
	sqlite
		.prepare(
			`insert into inbox_message (id, thread_id, direction, body) values (?, ?, 'inbound', 'private words')`
		)
		.run(`m-${id}`, id);
	sqlite
		.prepare(
			`insert into inbox_note (id, thread_id, author_user_id, body) values (?, ?, 'staff-1', 'staff note')`
		)
		.run(`n-${id}`, id);
}

function flag(threadId: string, status: string) {
	sqlite
		.prepare(
			`insert into content_flag (id, entity_type, entity_id, reported_by_user_id, reason, status)
			 values (?, 'inbox_thread', ?, 'member-1', 'harassment', ?)`
		)
		.run(`f-${threadId}-${status}`, threadId, status);
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

beforeEach(() => {
	for (const t of ['content_flag', 'inbox_note', 'inbox_message', 'inbox_thread']) {
		sqlite.exec(`delete from ${t}`);
	}
	thread('email', 'email');
	thread('portal', 'portal');
	for (const channel of PRIVATE) thread(channel, channel);
	// Only a pending report brings a private thread in; a dismissed one does not.
	thread('reported-dm', 'direct');
	flag('reported-dm', 'pending');
	thread('dismissed-dm', 'direct');
	flag('dismissed-dm', 'dismissed');
});

const VISIBLE = ['email', 'portal', 'reported-dm'];

describe('listThreads', () => {
	it('applies the exclusion with no filters at all', async () => {
		// The regression this guards: the exclusion drifting inside an
		// `if (filters.…)` branch, where it would only apply on a filtered view.
		const result = await listThreads({}, { page: 1, pageSize: 20 });
		expect(ids(result.rows)).toEqual(VISIBLE);
	});

	it('still applies it alongside a search, which LIKEs the private preview', async () => {
		const result = await listThreads({ search: 'hello' }, { page: 1, pageSize: 20 });
		expect(ids(result.rows)).toEqual(VISIBLE);
	});

	it.each(PRIVATE)('still applies it when filtering by the %s channel', async (channel) => {
		const result = await listThreads({ channel }, { page: 1, pageSize: 20 });
		expect(ids(result.rows)).toEqual(channel === 'direct' ? ['reported-dm'] : []);
	});
});

describe('listThreadsByContactEmail', () => {
	it('applies the exclusion, rather than relying on a null contactEmail', async () => {
		// Every private thread here carries the address, which is the day this
		// test exists for: matching on it must still not reveal them.
		const result = await listThreadsByContactEmail(EMAIL, { page: 1, pageSize: 10 });
		expect(ids(result.rows)).toEqual(VISIBLE);
	});
});

describe('the aggregate counts', () => {
	it('getUnresolvedCount excludes private threads from the staff badge', async () => {
		expect(await getUnresolvedCount()).toBe(VISIBLE.length);
	});

	it('countThreadsByStatus excludes them from the status tabs', async () => {
		expect((await countThreadsByStatus()).open).toBe(VISIBLE.length);
	});
});

describe('getThread', () => {
	it.each([...PRIVATE, 'dismissed-dm'])('returns null for the %s thread', async (id) => {
		expect(await getThread(id)).toBeNull();
	});

	it.each(PRIVATE)('refuses a %s thread before reading anything else', async (id) => {
		// Refused before the fetch, not filtered after it: the channel probe is the
		// only query a staff request for a private thread may make.
		const select = vi.spyOn(testDb, 'select');
		try {
			await getThread(id);
			expect(select).toHaveBeenCalledTimes(1);
		} finally {
			select.mockRestore();
		}
	});

	it('returns null when the thread does not exist', async () => {
		expect(await getThread('nope')).toBeNull();
	});

	it('still serves a portal thread, notes and all', async () => {
		const result = await getThread('portal');
		expect(result?.messages).toHaveLength(1);
		expect(result?.notes).toHaveLength(1);
	});
});
