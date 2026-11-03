import { describe, it, expect, vi, beforeEach } from 'vitest';

// band-service is the boundary between one act and the enquiries its public
// booking form collects. Three invariants matter more than anything else:
//
//   1. Ownership is `inbox_thread.group_id = <the resolved band>` in the WHERE
//      clause, so one band's admin cannot read another's by guessing a uuid.
//   2. Nothing here reads inbox_note. Notes are staff-private.
//   3. Nothing here writes inbox_participant: a participant row on a band
//      thread would surface a booking enquiry in /member/messages.
//
// Against a real SQLite, because a mocked `db` agrees with any WHERE.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));

// The outward email is the outside service; everything up to it is real.
const dispatchReply = vi.fn(async () => 'pm-1');
vi.mock('./channel-dispatcher', () => ({ dispatchReply: () => dispatchReply() }));

const {
	getBandThread,
	listBandThreads,
	handleBandEnquiry,
	replyToBandThread,
	setBandThreadStatus,
	markBandThreadRead,
	countBandUnread,
	bandOfThread
} = await import('./band-service');

const T0 = 1_750_000_000;

function thread(
	id: string,
	opts: { channel?: string; groupId?: string | null; status?: string; awaiting?: number } = {}
) {
	sqlite
		.prepare(
			`insert into inbox_thread (id, channel, group_id, status, subject, contact_email, last_message_at, awaiting_reply_since)
			 values (?, ?, ?, ?, 'Booking enquiry', 'ada@example.com', ?, ?)`
		)
		.run(
			id,
			opts.channel ?? 'band',
			opts.groupId === undefined ? 'band-1' : opts.groupId,
			opts.status ?? 'open',
			T0,
			opts.awaiting ?? null
		);
}

function message(id: string, threadId: string, body: string) {
	sqlite
		.prepare(
			`insert into inbox_message (id, thread_id, direction, body, author_name, author_user_id, created_at)
			 values (?, ?, 'outbound', ?, 'Wren', 'user-1', ?)`
		)
		.run(id, threadId, body, T0);
}

const count = (table: string) =>
	(sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
const statusOf = (id: string) =>
	sqlite
		.prepare('select status, awaiting_reply_since as awaiting from inbox_thread where id = ?')
		.get(id);

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of [
		'inbox_group_read',
		'inbox_participant',
		'inbox_note',
		'inbox_message',
		'inbox_thread'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
});

describe('getBandThread', () => {
	it('returns null for another band’s thread', async () => {
		thread('t1', { groupId: 'band-2' });
		expect(await getBandThread('t1', 'band-1')).toBeNull();
	});

	it('returns null for a thread on another channel', async () => {
		// group_id is set too, so only the channel predicate refuses it.
		thread('t1', { channel: 'portal' });
		expect(await getBandThread('t1', 'band-1')).toBeNull();
	});

	it('never returns inbox_note content', async () => {
		thread('t1');
		message('m1', 't1', 'yes');
		sqlite.exec(
			`insert into inbox_note (id, thread_id, author_user_id, body) values ('n1', 't1', 'staff-1', 'STAFF-ONLY')`
		);

		const result = await getBandThread('t1', 'band-1');

		expect(result?.messages).toHaveLength(1);
		expect(JSON.stringify(result)).not.toContain('STAFF-ONLY');
	});

	it('does not return author user ids', async () => {
		thread('t1');
		message('m1', 't1', 'yes');

		const result = await getBandThread('t1', 'band-1');

		// The timeline orients on `direction` — the band reads as an organisation,
		// like staff do — so a bandmate's id has no reader and is not sent.
		expect(result?.messages[0]).not.toHaveProperty('authorUserId');
		expect(result?.messages[0].authorName).toBe('Wren');
	});
});

describe('listBandThreads', () => {
	it('lists only this band’s band-channel threads', async () => {
		thread('mine');
		thread('theirs', { groupId: 'band-2' });
		thread('portal', { channel: 'portal' });

		const result = await listBandThreads('band-1', 'user-1', { page: 1, pageSize: 20 });

		expect(result.rows.map((r) => r.id)).toEqual(['mine']);
	});
});

describe('handleBandEnquiry', () => {
	const enquiry = {
		groupId: 'band-1',
		name: 'Ada',
		email: 'ada@example.com',
		message: 'Can you play the 14th?'
	};

	it('always opens a new thread, owned by the band', async () => {
		const first = await handleBandEnquiry(enquiry);
		const second = await handleBandEnquiry(enquiry);

		expect(first.threadId).not.toBe(second.threadId);
		expect(
			sqlite.prepare('select channel, group_id from inbox_thread where id = ?').get(first.threadId)
		).toEqual({ channel: 'band', group_id: 'band-1' });
		expect(count('inbox_message')).toBe(2);
	});

	it('writes no participant row for the enquirer or the band', async () => {
		await handleBandEnquiry(enquiry);
		expect(count('inbox_participant')).toBe(0);
	});
});

describe('replyToBandThread', () => {
	const reply = (groupId: string) => ({
		threadId: 't1',
		groupId,
		userId: 'user-1',
		userName: 'Wren',
		body: 'sure'
	});

	it('refuses a thread that is not this band’s, without sending anything', async () => {
		thread('t1', { groupId: 'band-2' });

		expect(await replyToBandThread(reply('band-1'))).toBeNull();
		expect(dispatchReply).not.toHaveBeenCalled();
		expect(count('inbox_message')).toBe(0);
	});

	it('refuses a resolved thread', async () => {
		thread('t1', { status: 'resolved' });

		expect(await replyToBandThread(reply('band-1'))).toBeNull();
		expect(dispatchReply).not.toHaveBeenCalled();
	});

	it('sends, records the message, and stamps the sender’s cursor', async () => {
		thread('t1');

		const result = await replyToBandThread(reply('band-1'));

		expect(dispatchReply).toHaveBeenCalledTimes(1);
		expect(result?.messageId).toEqual(expect.any(String));
		expect(
			sqlite.prepare('select user_id from inbox_group_read where thread_id = ?').all('t1')
		).toEqual([{ user_id: 'user-1' }]);
		expect(count('inbox_participant')).toBe(0);
	});
});

describe('setBandThreadStatus', () => {
	it('reports false and changes nothing when the row belongs to someone else', async () => {
		thread('t1', { groupId: 'band-2' });

		expect(await setBandThreadStatus('t1', 'band-1', 'resolved')).toBe(false);
		expect(statusOf('t1')).toMatchObject({ status: 'open' });
	});

	it('clears the awaiting-reply marker when resolving, and not when reopening', async () => {
		thread('t1', { awaiting: T0 });
		expect(await setBandThreadStatus('t1', 'band-1', 'resolved')).toBe(true);
		expect(statusOf('t1')).toEqual({ status: 'resolved', awaiting: null });

		thread('t2', { status: 'resolved', awaiting: T0 });
		await setBandThreadStatus('t2', 'band-1', 'open');
		expect(statusOf('t2')).toEqual({ status: 'open', awaiting: T0 });
	});
});

describe('markBandThreadRead', () => {
	it('writes no cursor for a thread the band does not own', async () => {
		// Otherwise the row itself confirms a thread exists at that id.
		thread('t1', { groupId: 'band-2' });

		await markBandThreadRead('t1', 'band-1', 'user-1');

		expect(count('inbox_group_read')).toBe(0);
	});

	it('writes one cursor to inbox_group_read, never inbox_participant', async () => {
		thread('t1');

		await markBandThreadRead('t1', 'band-1', 'user-1');
		await markBandThreadRead('t1', 'band-1', 'user-1');

		expect(count('inbox_group_read')).toBe(1);
		expect(count('inbox_participant')).toBe(0);
	});
});

describe('countBandUnread', () => {
	it('counts only this band’s open threads this reader has not caught up on', async () => {
		thread('unread');
		thread('read');
		sqlite.exec(
			`insert into inbox_group_read (id, thread_id, user_id, last_read_at) values ('r1', 'read', 'user-1', ${T0 + 10})`
		);
		thread('resolved', { status: 'resolved' });
		thread('theirs', { groupId: 'band-2' });

		expect(await countBandUnread('band-1', 'user-1')).toBe(1);
		// Another bandmate's cursor is not this reader's.
		expect(await countBandUnread('band-1', 'user-2')).toBe(2);
	});
});

describe('bandOfThread', () => {
	it('answers the owning band for a band thread', async () => {
		thread('t1');
		expect(await bandOfThread('t1')).toBe('band-1');
	});

	it('answers null for a thread on any other channel', async () => {
		thread('t1', { channel: 'group' });
		expect(await bandOfThread('t1')).toBeNull();
	});
});
