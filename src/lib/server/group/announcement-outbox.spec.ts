import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Announcement emails on the outbox (#2971), against a real SQLite: the rows
 * and the recipient count commit together, a recipient Postmark refuses stays
 * pending with the reason while the rest are sent, and a retry sends it. The
 * roster query and Postmark are mocked; the outbox and the batch are real.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

const { mockEnv, batchSend } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	batchSend: vi.fn()
}));

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock(mockEnv)
);
vi.mock('postmark', () => ({
	ServerClient: class {
		sendEmailBatchWithTemplates = batchSend;
	}
}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	contactEmail: async () => 'hello@example.org'
}));
vi.mock('#lib/server/notification/sse.js', () => ({ pushToUser: vi.fn() }));

const recipients = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('./announcement-service', async (importOriginal) => ({
	...(await importOriginal<typeof import('./announcement-service')>()),
	claimForNotification: async () => true,
	findAnnouncementThread: async () => null,
	listRecipients: async () => recipients.list
}));

const { fanOutAnnouncement } = await import('./announcement-fanout');
const { retryNow } = await import('#lib/server/outbox/outbox-service.js');
const { resetMailClient } = await import('#lib/server/notification/email/postmark-client.js');

const member = (i: number) => ({
	userId: `u${i}`,
	name: `Member ${i}`,
	email: `m${i}@example.com`,
	emailEnabled: true,
	inAppEnabled: false
});

const event = {
	announcementId: 'ann-1',
	groupId: 'g1',
	groupName: 'Real Book Club',
	groupSlug: 'real-book-club',
	groupKind: 'club' as const,
	title: 'Jam moved',
	body: 'The jam moves to the 27th.',
	authorId: 'author',
	authorName: 'Alice'
};

/** Postmark takes every message except those to `refused`. */
function postmarkRefuses(...refused: string[]) {
	batchSend.mockImplementation(async (msgs: { To: string }[]) =>
		msgs.map((m, i) =>
			refused.includes(m.To)
				? { To: m.To, ErrorCode: 406, Message: 'Inactive recipient', MessageID: '' }
				: { To: m.To, ErrorCode: 0, Message: 'OK', MessageID: `pm-${i}` }
		)
	);
}

const outbox = () =>
	sqlite
		.prepare(
			`select id, json_extract(payload, '$.to') as "to", status, last_error as error, subject_type as type
			 from outbox_message order by "to"`
		)
		.all() as { id: string; to: string; status: string; error: string | null; type: string }[];

beforeEach(() => {
	sqlite.exec(
		'pragma foreign_keys = off; delete from outbox_message; delete from group_announcement;'
	);
	sqlite
		.prepare(
			`insert into group_announcement (id, group_id, title, body) values ('ann-1', 'g1', 't', 'b')`
		)
		.run();
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	Object.assign(mockEnv, {
		MAIL_DRIVER: 'postmark',
		POSTMARK_SERVER_TOKEN: 'test-token',
		POSTMARK_TRANSACTIONAL_STREAM: 'outbound'
	});
	batchSend.mockReset();
	resetMailClient();
});

describe('announcement emails on the outbox', () => {
	it('writes a row per recipient with the count, and sends them', async () => {
		recipients.list = [member(1), member(2)];
		postmarkRefuses();

		await fanOutAnnouncement(event, 'https://test.corvmc.org');

		expect(outbox()).toEqual([
			expect.objectContaining({ to: 'm1@example.com', status: 'sent', type: 'group_announcement' }),
			expect.objectContaining({ to: 'm2@example.com', status: 'sent', type: 'group_announcement' })
		]);
		expect(
			sqlite.prepare(`select recipient_count as n from group_announcement where id = 'ann-1'`).get()
		).toEqual({ n: 2 });
	});

	it('leaves a refused recipient pending with the reason, and a retry sends it', async () => {
		recipients.list = [member(1), member(2)];
		postmarkRefuses('m2@example.com');

		await fanOutAnnouncement(event, 'https://test.corvmc.org');

		const [sent, refused] = outbox();
		expect(sent).toMatchObject({ status: 'sent', error: null });
		expect(refused).toMatchObject({ status: 'pending', error: '406: Inactive recipient' });

		postmarkRefuses();
		expect(await retryNow(refused.id)).toMatchObject({ status: 'sent', error: null });
		expect(outbox().map((r) => r.status)).toEqual(['sent', 'sent']);
	});
});
