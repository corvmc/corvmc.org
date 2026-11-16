import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { firstResponseByChannel } = await import('./response-time-service');
const { FIRST_RESPONSE_WINDOW_DAYS } = await import('#lib/config.js');

const NOW = new Date('2026-11-13T12:00:00Z');
const NOW_S = NOW.getTime() / 1000;
const DAY = 86_400;
const HOUR = 3_600;

let seq = 0;

function thread(channel: string, status = 'open') {
	const id = `t${++seq}`;
	sqlite
		.prepare(`insert into inbox_thread (id, channel, status) values (?, ?, ?)`)
		.run(id, channel, status);
	return id;
}

function message(threadId: string, direction: string, at: number) {
	sqlite
		.prepare(
			`insert into inbox_message (id, thread_id, direction, body, created_at) values (?, ?, ?, 'x', ?)`
		)
		.run(`m${++seq}`, threadId, direction, at);
}

const byChannel = async () =>
	Object.fromEntries((await firstResponseByChannel(NOW)).map((r) => [r.channel, r]));

beforeEach(() => {
	sqlite.exec('delete from inbox_message; delete from inbox_thread;');
});

describe('firstResponseByChannel', () => {
	it('counts an inbound-only thread as waiting, outside the median', async () => {
		message(thread('email'), 'inbound', NOW_S - HOUR);

		expect((await byChannel()).email).toEqual({
			channel: 'email',
			medianSeconds: null,
			replied: 0,
			waiting: 1
		});
	});

	it('measures from the first inbound message to the first outbound one', async () => {
		const t = thread('email');
		message(t, 'inbound', NOW_S - 10 * HOUR);
		message(t, 'inbound', NOW_S - 9 * HOUR);
		message(t, 'outbound', NOW_S - 7 * HOUR);
		message(t, 'outbound', NOW_S - 1 * HOUR);

		expect((await byChannel()).email).toMatchObject({ medianSeconds: 3 * HOUR, replied: 1 });
	});

	it('ignores an outbound message sent before the first inbound one', async () => {
		const t = thread('sms');
		message(t, 'outbound', NOW_S - 5 * HOUR);
		message(t, 'inbound', NOW_S - 4 * HOUR);

		expect((await byChannel()).sms).toMatchObject({ replied: 0, waiting: 1 });
	});

	it('takes the median per channel, averaging the middle pair', async () => {
		for (const hours of [1, 2, 3, 10]) {
			const t = thread('web');
			message(t, 'inbound', NOW_S - 20 * HOUR);
			message(t, 'outbound', NOW_S - 20 * HOUR + hours * HOUR);
		}
		for (const hours of [4, 5, 100]) {
			const t = thread('sms');
			message(t, 'inbound', NOW_S - 5 * DAY);
			message(t, 'outbound', NOW_S - 5 * DAY + hours * HOUR);
		}

		const rows = await byChannel();
		expect(rows.web).toMatchObject({ medianSeconds: 2.5 * HOUR, replied: 4 });
		expect(rows.sms).toMatchObject({ medianSeconds: 5 * HOUR, replied: 3 });
	});

	it('keeps threads whose first inbound message is inside the window only', async () => {
		const inside = thread('email');
		message(inside, 'inbound', NOW_S - FIRST_RESPONSE_WINDOW_DAYS * DAY);
		message(inside, 'outbound', NOW_S - FIRST_RESPONSE_WINDOW_DAYS * DAY + HOUR);

		const outside = thread('email');
		message(outside, 'inbound', NOW_S - FIRST_RESPONSE_WINDOW_DAYS * DAY - 1);
		message(outside, 'inbound', NOW_S - HOUR);

		expect((await byChannel()).email).toEqual({
			channel: 'email',
			medianSeconds: HOUR,
			replied: 1,
			waiting: 0
		});
	});

	it('leaves out resolved threads with no reply, and channels staff do not answer', async () => {
		message(thread('email', 'resolved'), 'inbound', NOW_S - HOUR);
		const dm = thread('direct');
		message(dm, 'inbound', NOW_S - 2 * HOUR);
		message(dm, 'outbound', NOW_S - HOUR);

		expect(await firstResponseByChannel(NOW)).toEqual([]);
	});
});
