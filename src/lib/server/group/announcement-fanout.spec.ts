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
	findAnnouncementThread: async () => 'thread-announcements',
	listRecipients: (...a: unknown[]) => mockList(...(a as [])),
	recordRecipientCount: (id: string, n: number) => mockRecord(id, n),
	recipientCountStatement: (id: string, n: number) => ({ count: { id, n } })
}));

type Statement = { table?: unknown; rows?: unknown[]; count?: { id: string; n: number } };

/** Every statement handed to `db.batch`, one array per call. */
let batches: Statement[][] = [];

vi.mock('#lib/server/db/index.js', () => ({
	db: {
		insert: (table: unknown) => ({
			values: (rows: unknown[]) => ({
				table,
				rows,
				// What `chunkInsert` measures: nine bound parameters per outbox row.
				toSQL: () => ({ params: new Array(rows.length * 9) })
			})
		}),
		batch: (statements: Statement[]) => {
			batches.push(statements);
			return Promise.resolve(statements.map(() => []));
		}
	}
}));

const mockDeliverSoon = vi.fn(async (_ids: string[]) => {});
vi.mock('#lib/server/outbox/outbox-service.js', () => ({
	deliverSoon: (ids: string[]) => mockDeliverSoon(ids)
}));

const mockPush = vi.fn();
vi.mock('#lib/server/notification/sse.js', () => ({
	pushToUser: (...a: unknown[]) => mockPush(...(a as []))
}));

vi.mock('#lib/server/db/schema/notification.js', () => ({
	notification: { id: 'id' },
	getNotificationType: () => ({ defaults: { email: true, inApp: true, sms: false } })
}));

const { fanOutAnnouncement, announcementsHref } = await import('./announcement-fanout');
const { outboxMessage } = await import('#lib/server/db/schema/outbox.js');
const { notification } = await import('#lib/server/db/schema/notification.js');

const statementsInto = (table: unknown) => batches.flat().filter((st) => st.table === table);
/** The in-app inserts, one array of rows per statement. */
const inAppInserts = () => statementsInto(notification).map((st) => st.rows ?? []);

type EmailRow = {
	id: string;
	kind: string;
	subjectType: string;
	subjectId: string;
	payload: { to: string; templateAlias: string; tag: string; model: Record<string, unknown> };
};
/** The outbox rows written, one per email. */
const emails = () => statementsInto(outboxMessage).flatMap((st) => st.rows as EmailRow[]);

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
	batches = [];
});

// ---------------------------------------------------------------------------

describe('the latch', () => {
	it('sends nothing when another invocation already claimed the send', async () => {
		claimed = false;
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		// Not "sends less" — sends nothing, and does not even resolve recipients.
		expect(mockList).not.toHaveBeenCalled();
		expect(batches).toHaveLength(0);
		expect(mockDeliverSoon).not.toHaveBeenCalled();
	});

	it('claims before doing any work', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(mockClaim).toHaveBeenCalledWith('ann-1');
		expect(emails()).toHaveLength(1);
	});
});

describe('recipients', () => {
	it('asks for the roster minus the author', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		// The exclusions live in the query, so this pins that both ids actually
		// reach it: the author, because being emailed your own post reads as a
		// bug, and the room, because a reader who muted it is excluded there
		// rather than here (#1309). The room is the Announcements thread (#2618).
		expect(mockList).toHaveBeenCalledWith('group-1', 'user-author', 'thread-announcements');
	});

	it('records a count of zero and sends nothing when nobody is left', async () => {
		recipients = [];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(recordedCount).toBe(0);
		expect(batches).toHaveLength(0);
		expect(mockDeliverSoon).not.toHaveBeenCalled();
	});

	it('records the roster in the same batch as its email rows', async () => {
		recipients = [member(1), member(2), member(3)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		const withCount = batches.filter((b) => b.some((st) => st.count));
		expect(withCount).toHaveLength(1);
		expect(withCount[0].find((st) => st.count)?.count).toEqual({ id: 'ann-1', n: 3 });
		expect(
			withCount[0].filter((st) => st.table === outboxMessage).flatMap((st) => st.rows)
		).toHaveLength(3);
	});
});

describe('channel preferences', () => {
	it('gives the bell to someone who turned email off', async () => {
		recipients = [member(1, { emailEnabled: false })];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(inAppInserts().flat()).toHaveLength(1);
		expect(emails()).toHaveLength(0);
		expect(mockDeliverSoon).not.toHaveBeenCalled();
	});

	it('emails someone who turned the bell off', async () => {
		recipients = [member(1, { inAppEnabled: false })];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(inAppInserts()).toHaveLength(0);
		expect(emails()).toHaveLength(1);
	});

	it('still counts a member who receives on neither channel', async () => {
		// They are on the roster and the post is theirs to read on the page. The
		// count is who it was for, not how many emails went out.
		recipients = [member(1, { emailEnabled: false, inAppEnabled: false })];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		expect(batches.flat().find((st) => st.count)?.count?.n).toBe(1);
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

		expect(inAppInserts().length).toBeGreaterThan(1);
		for (const rows of inAppInserts()) {
			expect(rows.length * 7).toBeLessThanOrEqual(100);
		}
		// Chunked, not truncated.
		expect(inAppInserts().flat()).toHaveLength(30);
	});

	it('writes an outbox row per email, in statements D1 will accept', async () => {
		recipients = Array.from({ length: 30 }, (_, i) => member(i));

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		const inserts = statementsInto(outboxMessage);
		expect(inserts.length).toBeGreaterThan(1);
		for (const st of inserts) expect((st.rows ?? []).length * 9).toBeLessThanOrEqual(100);
		expect(emails()).toHaveLength(30);
		expect(emails()[0]).toMatchObject({
			kind: 'email',
			subjectType: 'group_announcement',
			subjectId: 'ann-1',
			payload: { templateAlias: 'notification', tag: 'announcement', to: 'member0@test.com' }
		});
		// Sent by the outbox, once, for every row written.
		expect(mockDeliverSoon).toHaveBeenCalledTimes(1);
		expect(mockDeliverSoon.mock.calls[0][0]).toEqual(emails().map((e) => e.id));
	});
});

describe('the email', () => {
	it('carries a way to mute the group', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		const model = firstModel();
		// Not decoration. These ride the transactional stream, which also carries
		// password resets, so a spam complaint here is expensive — and "there is a
		// setting somewhere" is what makes people press that button instead.
		expect(String(model.footnote)).toContain('Real Book Club');
		expect(String(model.footnote)).toContain('/member/groups/real-book-club');
	});

	it('reads as the message, with the author as a byline', async () => {
		recipients = [member(1)];

		await fanOutAnnouncement(event(), 'https://test.corvmc.org');

		const model = firstModel();
		expect(model.subject).toBe('Real Book Club: August jam moved');
		expect(model.heading).toBe('August jam moved');
		expect(model.byline).toBe('From Alice, Real Book Club');
		expect(model).not.toHaveProperty('paragraphs');
		expect(model).not.toHaveProperty('quote');
	});

	it('carries the whole post, however long', async () => {
		recipients = [member(1)];
		const long = `${'word '.repeat(300)}THE-END`;

		await fanOutAnnouncement(event({ body: long }), 'https://test.corvmc.org');

		const model = firstModel();
		expect(String(model.body_html)).toContain('THE-END');
		expect(String(model.body_text)).toContain('THE-END');
		expect(String(model.body_text).length).toBeGreaterThan(400);
	});

	it('renders the markdown', async () => {
		recipients = [member(1)];
		const body =
			'## Bring\n\n- a chart\n- a stand\n\nSee [the page](https://corvmc.org/x), *please*.';

		await fanOutAnnouncement(event({ body }), 'https://test.corvmc.org');

		const html = String(firstModel().body_html);
		expect(html).toContain('<h2');
		expect(html).toContain('<li>a chart</li>');
		expect(html).toMatch(/<a href="https:\/\/corvmc.org\/x"[^>]*>the page<\/a>/);
		expect(html).toContain('<em>please</em>');
	});

	it('sanitizes markup a member wrote into the post', async () => {
		recipients = [member(1)];
		const body =
			'Hi <script>alert(1)</script><img src=x onerror="alert(2)"> [x](javascript:alert(3))';

		await fanOutAnnouncement(event({ body }), 'https://test.corvmc.org');

		const html = String(firstModel().body_html);
		expect(html).not.toMatch(/<script|onerror|javascript:/i);
	});

	it('keeps the bell to an excerpt', async () => {
		recipients = [member(1)];
		const long = `${'word '.repeat(300)}THE-END`;

		await fanOutAnnouncement(event({ body: long }), 'https://test.corvmc.org');

		const [row] = inAppInserts().flat() as { body: string }[];
		expect(row.body.length).toBeLessThanOrEqual(400);
		expect(row.body).not.toContain('THE-END');
	});
});

function firstModel(): Record<string, unknown> {
	return emails()[0].payload.model;
}

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
