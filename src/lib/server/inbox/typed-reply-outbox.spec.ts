import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A typed reply on the outbox (#2971), against a real SQLite: the message, the
 * thread's move and the `inbox_reply` row commit in one `db.batch`, a refused
 * send leaves the message on the thread with its row pending, and a retry
 * sends it. The channel is the one thing mocked.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const dispatchReply = vi.fn();
vi.mock('./channel-dispatcher', () => ({ dispatchReply: () => dispatchReply() }));

const { addOutboundMessage, retryReply } = await import('./message-service');
const { getThread } = await import('./thread-service');

const T0 = 1_750_000_000;

function thread(id: string) {
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, status, subject, contact_email, last_message_at)
			 values (?, 'web', 'open', 'Studio rates', 'ada@example.com', ?)`
		)
		.run(id, T0);
}

const reply = (threadId = 't1') =>
	addOutboundMessage({
		threadId,
		body: 'Yes, ten dollars.',
		authorUserId: 'u1',
		authorName: 'Wren'
	});

const outboxRows = () =>
	sqlite
		.prepare(`select kind, payload, status, last_error as lastError from outbox_message`)
		.all() as { kind: string; payload: string; status: string; lastError: string | null }[];

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['outbox_message', 'inbox_message', 'inbox_thread']) {
		sqlite.exec(`delete from ${t}`);
	}
});

describe('a typed reply', () => {
	it('files the message, the thread move and the outbox row in one batch', async () => {
		thread('t1');
		dispatchReply.mockResolvedValueOnce('<pm-1@corvmc.org>');
		const batch = vi.spyOn(testDb, 'batch');

		const { id } = await reply();

		// The second batch is the send recording its result.
		expect(batch).toHaveBeenCalledTimes(2);
		expect(batch.mock.calls[0][0]).toHaveLength(3);
		const [row] = outboxRows();
		expect(row).toMatchObject({ kind: 'inbox_reply', status: 'sent' });
		expect(JSON.parse(row.payload)).toEqual({ messageId: id });
		batch.mockRestore();
	});

	it('sends at once and answers with the result', async () => {
		thread('t1');
		dispatchReply.mockResolvedValueOnce('<pm-1@corvmc.org>');

		const { id, delivery } = await reply();

		expect(delivery).toMatchObject({ status: 'sent', error: null });
		expect(
			sqlite.prepare('select channel_message_id as c from inbox_message where id = ?').get(id)
		).toEqual({ c: '<pm-1@corvmc.org>' });
		expect((await getThread('t1'))?.messages[0].delivery).toBeNull();
	});

	it('keeps a refused reply on the thread, pending with its error', async () => {
		thread('t1');
		dispatchReply.mockRejectedValueOnce(new Error('406 Inactive recipient'));

		const { id, delivery } = await reply();

		expect(delivery).toMatchObject({ status: 'pending', error: '406 Inactive recipient' });
		expect(outboxRows()).toEqual([
			expect.objectContaining({ status: 'pending', lastError: '406 Inactive recipient' })
		]);
		const shown = await getThread('t1');
		expect(shown?.messages.map((m) => [m.id, m.delivery])).toEqual([
			[id, { status: 'pending', error: '406 Inactive recipient' }]
		]);
	});

	it('sends a refused reply on retry', async () => {
		thread('t1');
		dispatchReply.mockRejectedValueOnce(new Error('406 Inactive recipient'));
		const { id } = await reply();

		dispatchReply.mockResolvedValueOnce('<pm-2@corvmc.org>');
		expect(await retryReply('t1', id)).toMatchObject({ status: 'sent', error: null });

		expect(outboxRows()).toEqual([expect.objectContaining({ status: 'sent', lastError: null })]);
		expect((await getThread('t1'))?.messages[0].delivery).toBeNull();
	});

	it('retries nothing for a message on another thread, or one that went', async () => {
		thread('t1');
		thread('t2');
		dispatchReply.mockResolvedValueOnce('<pm-3@corvmc.org>');
		const sent = await reply('t1');
		dispatchReply.mockRejectedValueOnce(new Error('timeout'));
		const unsent = await reply('t1');

		expect(await retryReply('t2', unsent.id)).toBeNull();
		expect(await retryReply('t1', sent.id)).toBeNull();
		expect(dispatchReply).toHaveBeenCalledTimes(2);
	});
});
