import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tag row keys each tag by its text, so a repeat must never reach it (#3284).
// The unique index on (thread_id, tag) is case-sensitive and lets two spellings in.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { addThreadTag, removeThreadTag, getThreadContext } = await import('./thread-service');

beforeEach(() => {
	for (const t of ['inbox_thread_tag', 'inbox_thread']) sqlite.prepare(`delete from ${t}`).run();
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, status, subject, preview, contact_email, last_message_at)
			 values ('t1', 'email', 'open', 'hello', 'hello', 'a@example.com', 1750000000)`
		)
		.run();
});

describe('thread tags', () => {
	it('lists a tag added in two spellings once', async () => {
		await addThreadTag('t1', 'Urgent');
		await addThreadTag('t1', 'urgent');
		await addThreadTag('t1', 'billing');
		const context = await getThreadContext('t1');
		expect(context?.tags).toEqual(['Urgent', 'billing']);
	});

	it('removes every spelling of a tag', async () => {
		await addThreadTag('t1', 'Urgent');
		await addThreadTag('t1', 'urgent');
		await removeThreadTag('t1', 'Urgent');
		const context = await getThreadContext('t1');
		expect(context?.tags).toEqual([]);
	});
});
