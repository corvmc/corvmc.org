import { describe, it, expect, vi, beforeEach } from 'vitest';

// `findOrCreateThread` against a real SQLite (#2681). Two inbound messages
// from one contact at once both read no open thread; they have to end up in
// one, while channels that never fold keep opening a thread each.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { findOrCreateThread } = await import('./thread-service');

const threads = () =>
	sqlite.prepare('select id, channel from inbox_thread order by rowid').all() as {
		id: string;
		channel: string;
	}[];

beforeEach(() => {
	sqlite.exec('delete from inbox_thread');
});

describe('findOrCreateThread', () => {
	it.each([
		['email', { contactEmail: 'ada@example.com' }],
		['sms', { contactPhone: '+15415550100' }],
		['instagram', { contactExternalId: '1234567' }]
	] as const)('opens one %s thread when two first messages overlap', async (channel, contact) => {
		const [a, b] = await Promise.all([
			findOrCreateThread({ channel, ...contact }),
			findOrCreateThread({ channel, ...contact })
		]);

		expect(threads()).toEqual([{ id: a.id, channel }]);
		expect(b.id).toBe(a.id);
	});

	it('still opens a thread per message on the contact form', async () => {
		await Promise.all([
			findOrCreateThread({ channel: 'web', contactEmail: 'ada@example.com' }),
			findOrCreateThread({ channel: 'web', contactEmail: 'ada@example.com' })
		]);

		expect(threads()).toHaveLength(2);
	});

	it('joins the open thread rather than a resolved one', async () => {
		sqlite.exec(`insert into inbox_thread (id, channel, contact_email, status)
			values ('old', 'email', 'ada@example.com', 'resolved')`);

		const first = await findOrCreateThread({ channel: 'email', contactEmail: 'ada@example.com' });
		const second = await findOrCreateThread({ channel: 'email', contactEmail: 'ada@example.com' });

		expect(first.id).not.toBe('old');
		expect(second.id).toBe(first.id);
		expect(threads()).toHaveLength(2);
	});
});
