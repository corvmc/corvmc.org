import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The fan-out, which is the one notification in the app that is not one
 * dispatch per event.
 *
 * Three things here can be wrong in ways nothing else would catch: the latch
 * (the bus delivers at least once, and a roster emailed twice cannot be taken
 * back), the chunking (D1 rejects a statement over 100 bound params outright),
 * and the per-recipient channel split (a member who turned email off must still
 * get the bell).
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let claimed = true;
let recipients: unknown[] = [];
let recordedCount: number | null = null;

const mockClaim = vi.fn(async () => claimed);
const mockList = vi.fn(async () => recipients);
const mockRecord = vi.fn(async (_id: string, n: number) => {
	recordedCount = n;
});

vi.mock('./announcement-service', () => ({
	claimForNotification: (...a: unknown[]) => mockClaim(...(a as [])),
	listRecipients: (...a: unknown[]) => mockList(...(a as [])),
	recordRecipientCount: (id: string, n: number) => mockRecord(id, n)
}));

/** Every `db.insert(...).values(rows)` the batch was handed. */
let insertedBatches: unknown[][] = [];

vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({
			values: (rows: unknown[]) => {
				insertedBatches.push(rows);
				return { __statement: true };
			}
		}),
		batch: (statements: unknown[]) => Promise.resolve(statements.map(() => []))
	}
}));

const mockSendBatch = vi.fn(async () => {});
vi.mock('$lib/server/notification/email', () => ({
	sendTemplateBatch: (...a: unknown[]) => mockSendBatch(...(a as [])),
	type: {}
}));

const mockPush = vi.fn();
vi.mock('$lib/server/notification/sse', () => ({
	pushToUser: (...a: unknown[]) => mockPush(...(a as []))
}));

vi.mock('$lib/server/db/schema/notification', () => ({
	notification: { id: 'id' },
	getNotificationType: () => ({ defaults: { email: true, inApp: true, sms: false } })
}));

const { fanOutAnnouncement, announcementsHref } = await import('./announcement-fanout');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function event(over: Record<string, unknown> = {}) {
	return {
		announcementId: 'ann-1',
		groupId: 'group-1',
		groupName: 'Real Book Club',
		groupSlug: 'real-book-club',
		groupKind: 'club' as const,
		title: 'August jam moved',
		body: 'The **jam** moves to the 27th.',
		authorId: 'user-author',
		authorName: 'Alice',
		...over
	};
}

function member(i: number, over: Record<string, unknown> = {}) {
	return {
		userId: `user-${i}`,
		name: `Member ${i}`,
		email: `member${i}@test.com`,
		emailEnabled: true,
		inAppEnabled: true,
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	claimed = true;
	recipients = [];
	recordedCount = null;
	insertedBatches = [];
});

// ---------------------------------------------------------------------------

describe('the latch', () => {
	it('sends nothing when another invocation already claimed the send', async () => {
		claimed = false;
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		// Not "sends less" — sends nothing, and does not even resolve recipients.
		expect(mockList).not.toHaveBeenCalled();
		expect(mockSendBatch).not.toHaveBeenCalled();
		expect(insertedBatches).toHaveLength(0);
	});

	it('claims before doing any work', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(mockClaim).toHaveBeenCalledWith('ann-1');
		expect(mockSendBatch).toHaveBeenCalledTimes(1);
	});
});

describe('recipients', () => {
	it('asks for the roster minus the author', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		// The exclusions live in the query, so this pins that the author id
		// actually reaches it — being emailed your own post reads as a bug.
		expect(mockList).toHaveBeenCalledWith('group-1', 'user-author');
	});

	it('records a count of zero and sends nothing when nobody is left', async () => {
		recipients = [];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(recordedCount).toBe(0);
		expect(mockSendBatch).not.toHaveBeenCalled();
		expect(insertedBatches).toHaveLength(0);
	});

	it('records what the send reached', async () => {
		recipients = [member(1), member(2), member(3)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(recordedCount).toBe(3);
	});
});

describe('channel preferences', () => {
	it('gives the bell to someone who turned email off', async () => {
		recipients = [member(1, { emailEnabled: false })];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(insertedBatches.flat()).toHaveLength(1);
		expect(mockSendBatch).not.toHaveBeenCalled();
	});

	it('emails someone who turned the bell off', async () => {
		recipients = [member(1, { inAppEnabled: false })];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(insertedBatches).toHaveLength(0);
		expect(mockSendBatch).toHaveBeenCalledTimes(1);
	});

	it('still counts a member who receives on neither channel', async () => {
		// They are on the roster and the post is theirs to read on the page. The
		// count is who it was for, not how many emails went out.
		recipients = [member(1, { emailEnabled: false, inAppEnabled: false })];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(recordedCount).toBe(1);
	});
});

describe('chunking', () => {
	/**
	 * D1 rejects a statement with more than 100 bound parameters outright. A
	 * notification row binds seven columns, so a naive 200-row insert is not
	 * slow — it fails, and the whole roster gets nothing.
	 */
	it('splits the in-app inserts into statements D1 will accept', async () => {
		recipients = Array.from({ length: 30 }, (_, i) => member(i));

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(insertedBatches.length).toBeGreaterThan(1);
		for (const rows of insertedBatches) {
			expect(rows.length * 7).toBeLessThanOrEqual(100);
		}
		// Chunked, not truncated.
		expect(insertedBatches.flat()).toHaveLength(30);
	});

	it('sends the whole roster in one call to the batch sender', async () => {
		recipients = Array.from({ length: 30 }, (_, i) => member(i));

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		// One subrequest's worth of intent — `sendTemplateBatch` does Postmark's
		// own 500-per-call chunking internally.
		expect(mockSendBatch).toHaveBeenCalledTimes(1);
		const [, messages] = mockSendBatch.mock.calls[0] as unknown as [string, unknown[]];
		expect(messages).toHaveLength(30);
	});
});

describe('the email', () => {
	it('carries a way to mute the group', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		const [, messages] = mockSendBatch.mock.calls[0] as unknown as [
			string,
			{ to: string; model: Record<string, unknown> }[]
		];
		// Not decoration. These ride the transactional stream, which also carries
		// password resets, so a spam complaint here is expensive — and "there is a
		// setting somewhere" is what makes people press that button instead.
		expect(String(messages[0].model.footnote)).toContain('Mute Real Book Club');
		expect(String(messages[0].model.footnote)).toContain('/member/groups/real-book-club');
	});

	it('names the kind, so a club is not called a band', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		const [, messages] = mockSendBatch.mock.calls[0] as unknown as [
			string,
			{ model: Record<string, unknown> }[]
		];
		const paragraphs = messages[0].model.paragraphs as { text: string }[];
		expect(paragraphs[0].text).toContain('the club Real Book Club');
	});

	it('quotes the post rather than pasting a whole newsletter', async () => {
		recipients = [member(1)];
		const long = 'x'.repeat(2000);

		await fanOutAnnouncement(event({ body: long }), 'https://test.corvmc.org');

		const [, messages] = mockSendBatch.mock.calls[0] as unknown as [
			string,
			{ model: Record<string, unknown> }[]
		];
		// `quote` is escaped by the normalizer, so assert on length not identity.
		expect(String(messages[0].model.quote).length).toBeLessThan(500);
	});
});

describe('announcementsHref', () => {
	/**
	 * The one place the two mount points differ, and the email needs to land on
	 * the right one — a band has a panel, a club has a page with tabs.
	 */
	it('points a band at its panel and a club at its page', () => {
		expect(announcementsHref('band', 'the-foos')).toBe('/band/the-foos/announcements');
		expect(announcementsHref('club', 'real-book-club')).toBe('/member/groups/real-book-club');
		expect(announcementsHref('committee', 'programming')).toBe('/member/groups/programming');
	});
});
