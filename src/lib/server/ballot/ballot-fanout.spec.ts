import { describe, it, expect, beforeEach, vi } from 'vitest';
import { surfaces } from '#lib/config.js';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({
	db: testDb
}));

// Postmark is the one outside service; the outbox that writes and sends is real.
const { mockEnv, batchSend } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	batchSend: vi.fn()
}));
vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock(mockEnv)
);
vi.mock('postmark', () => ({
	ServerClient: class {
		sendEmailBatchWithTemplates = batchSend;
	}
}));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	contactEmail: async () => 'hello@example.org'
}));
vi.mock('#lib/server/notification/sse.js', () => ({ pushToUser: vi.fn() }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { fanOutBallotNotice } = await import('./ballot-fanout');
const { retryNow } = await import('#lib/server/outbox/outbox-service.js');
const { resetMailClient } = await import('#lib/server/notification/email/postmark-client.js');
const { user } = await import('#lib/server/db/schema/authentication.js');
const { notification, notificationPreference } =
	await import('#lib/server/db/schema/notification.js');
const { ballot, ballotElector } = await import('#lib/server/db/schema/ballot.js');

const BALLOT = 'bal-1';
const event = { ballotId: BALLOT, title: 'Adopt the bylaws' };

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

/** The outbox rows written, by recipient. */
function emails() {
	return sqlite
		.prepare(
			`select id, json_extract(payload, '$.to') as "to", json_extract(payload, '$.tag') as tag,
			 subject_type as type, subject_id as subjectId, status, last_error as error
			 from outbox_message order by "to"`
		)
		.all() as Record<string, string | null>[];
}

beforeEach(async () => {
	batchSend.mockReset();
	postmarkRefuses();
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	Object.assign(mockEnv, {
		MAIL_DRIVER: 'postmark',
		POSTMARK_SERVER_TOKEN: 'test-token',
		POSTMARK_TRANSACTIONAL_STREAM: 'outbound'
	});
	resetMailClient();
	surfaces.ballots = true;
	for (const t of [
		'outbox_message',
		'notification',
		'notification_preference',
		'ballot_elector',
		'ballot',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	await testDb.insert(user).values([
		{ id: 'u-elector', name: 'Ada Voter', email: 'ada@example.com', emailVerified: true },
		{ id: 'u-other', name: 'Bo Member', email: 'bo@example.com', emailVerified: true },
		{
			id: 'u-banned',
			name: 'Cy Banned',
			email: 'cy@example.com',
			emailVerified: true,
			deletedAt: new Date(),
			bannedAt: new Date()
		}
	] as never);
	await testDb.insert(ballot).values({
		id: BALLOT,
		kind: 'member',
		title: event.title,
		closesAt: new Date(Date.now() + 86_400_000),
		openedAt: new Date()
	});
	await testDb.insert(ballotElector).values([
		{ ballotId: BALLOT, userId: 'u-elector' },
		{ ballotId: BALLOT, userId: 'u-banned' }
	]);
});

async function notified() {
	return (await testDb.select({ userId: notification.userId }).from(notification))
		.map((r) => r.userId)
		.sort();
}

describe('while Ballots is switched off (#2116)', () => {
	it('sends nothing and leaves the notice unclaimed', async () => {
		surfaces.ballots = false;
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');
		expect(await notified()).toEqual([]);
		expect(emails()).toEqual([]);
	});
});

describe('the open notice', () => {
	it('reaches active electors only, in-app and by email', async () => {
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector']);
		expect(emails()).toEqual([
			expect.objectContaining({
				to: 'ada@example.com',
				tag: 'ballot_opened',
				type: 'ballot_opened',
				subjectId: BALLOT,
				status: 'sent'
			})
		]);
	});

	it('leaves a refused email pending with the reason, and a retry sends it', async () => {
		postmarkRefuses('ada@example.com');
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');

		const [refused] = emails();
		expect(refused).toMatchObject({ status: 'pending', error: '406: Inactive recipient' });

		postmarkRefuses();
		expect(await retryNow(String(refused.id))).toMatchObject({ status: 'sent', error: null });
		expect(emails().map((e) => e.status)).toEqual(['sent']);
	});

	it('sends once however many times the event is delivered', async () => {
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');
		await fanOutBallotNotice('ballot_opened', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector']);
		expect(emails()).toHaveLength(1);
	});
});

describe('the result notice', () => {
	it('reaches every active account in-app, and emails nobody by default', async () => {
		await fanOutBallotNotice('ballot_result', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector', 'u-other']);
		expect(emails()).toEqual([]);
	});

	it('honours a member who turned it off', async () => {
		await testDb.insert(notificationPreference).values({
			userId: 'u-other',
			notificationType: 'ballot_result',
			inAppEnabled: false,
			emailEnabled: false
		} as never);
		await fanOutBallotNotice('ballot_result', event, 'https://x.test');
		expect(await notified()).toEqual(['u-elector']);
	});
});
