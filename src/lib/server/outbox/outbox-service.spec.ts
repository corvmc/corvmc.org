import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The outbox against a real SQLite behind the D1 driver: the claim is an
 * `UPDATE ... RETURNING` whose `WHERE` is the whole lock, and `db.batch` is the
 * whole atomicity argument, so neither can be checked against a mocked `db`.
 * Postmark itself is the one thing mocked.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

const { mockEnv, constructed, batchSend, htmlSend } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	constructed: { count: 0 },
	batchSend: vi.fn(),
	htmlSend: vi.fn()
}));

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock(mockEnv)
);
vi.mock('postmark', () => ({
	ServerClient: class {
		constructor() {
			constructed.count++;
		}
		sendEmailBatchWithTemplates = batchSend;
		sendEmailWithTemplate = vi.fn();
		sendEmailBatch = htmlSend;
	}
}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	contactEmail: async () => 'hello@example.org'
}));

const { outboxMessage } = await import('#lib/server/db/schema/outbox.js');
const { reminderSent } = await import('#lib/server/db/schema/reminder.js');
const { emailRow, htmlEmailRow } = await import('./outbox-row');
const {
	deliverOutbox,
	deliverNow,
	queueEmail,
	MAX_ATTEMPTS,
	backoffMs,
	retryNow,
	latestDeliveries
} = await import('./outbox-service');
const { resetMailClient } = await import('#lib/server/notification/email/postmark-client.js');

const MAIL = { to: 'vendor@example.com', templateAlias: 'notification', model: { heading: 'Hi' } };
const T0 = new Date('2026-11-13T12:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

function rows() {
	return sqlite.prepare('select * from outbox_message').all() as Record<string, unknown>[];
}

function refuse(code = 406, message = 'Inactive recipient') {
	batchSend.mockImplementation(async (msgs: { To: string }[]) =>
		msgs.map((m) => ({ To: m.To, ErrorCode: code, Message: message, MessageID: '' }))
	);
}

function accept() {
	batchSend.mockImplementation(async (msgs: { To: string }[]) =>
		msgs.map((m, i) => ({ To: m.To, ErrorCode: 0, Message: 'OK', MessageID: `pm-${i}` }))
	);
}

beforeEach(() => {
	sqlite.exec('delete from outbox_message; delete from reminder_sent;');
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	mockEnv.MAIL_DRIVER = 'postmark';
	mockEnv.POSTMARK_SERVER_TOKEN = 'test-token';
	mockEnv.POSTMARK_TRANSACTIONAL_STREAM = 'outbound';
	constructed.count = 0;
	batchSend.mockReset();
	htmlSend.mockReset();
	resetMailClient();
});

async function insertDue(now = T0) {
	const row = emailRow(MAIL, { type: 'market_vendor', id: 'v-1' });
	await testDb.insert(outboxMessage).values({ ...row, nextAttemptAt: now, createdAt: now });
	return row.id;
}

describe('writing with the save', () => {
	const write = (id: string) =>
		testDb.insert(reminderSent).values({
			id,
			reminderKey: 'k',
			subjectType: 's',
			subjectId: id,
			sentAt: T0
		});

	it('commits the write and its outbox row together', async () => {
		const row = emailRow(MAIL);
		await testDb.batch([write('r-1'), testDb.insert(outboxMessage).values(row)]);
		expect(rows()).toHaveLength(1);
		expect(sqlite.prepare('select count(*) n from reminder_sent').get()).toEqual({ n: 1 });
	});

	it('keeps neither when the outbox row is refused', async () => {
		const row = emailRow(MAIL);
		await testDb.insert(outboxMessage).values(row);
		await expect(
			testDb.batch([write('r-2'), testDb.insert(outboxMessage).values(row)])
		).rejects.toThrow();
		expect(sqlite.prepare('select count(*) n from reminder_sent').get()).toEqual({ n: 0 });
	});
});

describe('a pre-rendered email (#2771)', () => {
	it('goes out as HTML on the transactional stream, with its own result', async () => {
		htmlSend.mockImplementation(async (msgs: { To: string }[]) =>
			msgs.map((m) => ({ To: m.To, ErrorCode: 0, Message: 'OK', MessageID: 'pm-html' }))
		);
		const row = htmlEmailRow({ to: 'staff@example.com', subject: 'Test', htmlBody: '<p>Hi</p>' });
		await testDb.insert(outboxMessage).values({ ...row, nextAttemptAt: T0, createdAt: T0 });

		const delivery = await deliverNow(row.id);

		expect(delivery).toEqual({ id: row.id, status: 'sent', error: null });
		expect(htmlSend.mock.calls[0][0]).toEqual([
			expect.objectContaining({
				To: 'staff@example.com',
				Subject: 'Test',
				HtmlBody: '<p>Hi</p>',
				MessageStream: 'outbound'
			})
		]);
		expect(batchSend).not.toHaveBeenCalled();
	});
});

describe('sending', () => {
	it('marks a sent row with the provider id and clears its claim', async () => {
		accept();
		const id = await insertDue();
		expect(await deliverOutbox({ now: T0 })).toEqual([{ id, status: 'sent', error: null }]);
		expect(rows()[0]).toMatchObject({
			status: 'sent',
			attempts: 1,
			provider_message_id: 'pm-0',
			claimed_until: null,
			last_error: null
		});
	});

	it('keeps a refused row pending with its error, and retries it after the backoff', async () => {
		refuse();
		const id = await insertDue();
		expect(await deliverOutbox({ now: T0 })).toEqual([
			{ id, status: 'pending', error: '406: Inactive recipient' }
		]);
		expect(rows()[0]).toMatchObject({
			status: 'pending',
			attempts: 1,
			last_error: '406: Inactive recipient',
			next_attempt_at: Math.floor(at(backoffMs(1)).getTime() / 1000)
		});

		// Not due before the backoff has passed.
		expect(await deliverOutbox({ now: at(backoffMs(1) - 1000) })).toEqual([]);

		accept();
		expect(await deliverOutbox({ now: at(backoffMs(1)) })).toEqual([
			{ id, status: 'sent', error: null }
		]);
		expect(rows()[0]).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
	});

	it('records a thrown send as the error on every row in the call', async () => {
		batchSend.mockRejectedValue(new Error('Postmark is down'));
		await insertDue();
		await insertDue();
		const out = await deliverOutbox({ now: T0 });
		expect(out.map((d) => d.error)).toEqual(['Postmark is down', 'Postmark is down']);
	});

	it('turns failed once the attempts run out, and stops retrying', async () => {
		refuse();
		await insertDue();
		let now = T0;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const [d] = await deliverOutbox({ now });
			expect(d.status).toBe(attempt === MAX_ATTEMPTS ? 'failed' : 'pending');
			now = new Date(now.getTime() + backoffMs(attempt));
		}
		expect(await deliverOutbox({ now: at(365 * 24 * 3600_000) })).toEqual([]);
		expect(rows()[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
	});

	it('sends a row once when two senders reach it together', async () => {
		accept();
		await insertDue();
		const [a, b] = await Promise.all([deliverOutbox({ now: T0 }), deliverOutbox({ now: T0 })]);
		expect(a.length + b.length).toBe(1);
		expect(batchSend).toHaveBeenCalledTimes(1);
	});

	it('answers deliverNow from the row it just tried', async () => {
		refuse(422, 'Invalid To');
		const id = await insertDue(new Date(Date.now() - 1000));
		expect(await deliverNow(id)).toEqual({ id, status: 'pending', error: '422: Invalid To' });
	});
});

describe('the log driver', () => {
	it('is the default, and sends without constructing a Postmark client', async () => {
		delete mockEnv.MAIL_DRIVER;
		delete mockEnv.POSTMARK_SERVER_TOKEN;
		delete mockEnv.POSTMARK_TRANSACTIONAL_STREAM;
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});

		const [id] = await queueEmail(MAIL);

		expect(constructed.count).toBe(0);
		expect(batchSend).not.toHaveBeenCalled();
		expect(rows()[0]).toMatchObject({ id, status: 'sent' });
		expect(String(rows()[0].provider_message_id)).toMatch(/^log-/);
		expect(log).toHaveBeenCalledWith(
			'[mail:log]',
			expect.objectContaining({ to: MAIL.to, template: 'notification' })
		);
		log.mockRestore();
	});
});

// #2819: staff resend a message the outbox gave up on, or is still backing off.
describe('sending again on request', () => {
	it('sends a failed message now, with fresh attempts', async () => {
		const id = await insertDue();
		sqlite
			.prepare(
				`update outbox_message set status = 'failed', attempts = ?, last_error = 'x' where id = ?`
			)
			.run(MAX_ATTEMPTS, id);
		accept();

		expect(await retryNow(id)).toMatchObject({ id, status: 'sent' });
		expect(rows()[0]).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
	});

	it('brings a backing-off message forward', async () => {
		const id = await insertDue();
		sqlite
			.prepare(`update outbox_message set next_attempt_at = ? where id = ?`)
			.run(Math.floor(Date.now() / 1000) + 3600, id);
		accept();

		expect(await retryNow(id)).toMatchObject({ status: 'sent' });
	});

	it('does not send a message twice', async () => {
		const id = await insertDue();
		sqlite.prepare(`update outbox_message set status = 'sent' where id = ?`).run(id);

		expect(await retryNow(id)).toBeNull();
		expect(batchSend).not.toHaveBeenCalled();
	});

	it('leaves a message a sender holds right now', async () => {
		const id = await insertDue();
		sqlite
			.prepare(`update outbox_message set claimed_until = ? where id = ?`)
			.run(Math.floor(Date.now() / 1000) + 60, id);

		expect(await retryNow(id)).toBeNull();
		expect(batchSend).not.toHaveBeenCalled();
	});
});

describe('the newest message per record', () => {
	it('answers each record with its latest message, for a list page', async () => {
		const older = emailRow(MAIL, { type: 'market_vendor', id: 'v-1' });
		const newer = emailRow(MAIL, { type: 'market_vendor', id: 'v-1' });
		const other = emailRow(MAIL, { type: 'campaign', id: 'v-2' });
		await testDb.insert(outboxMessage).values([
			{ ...older, status: 'failed', createdAt: at(0) },
			{ ...newer, status: 'sent', createdAt: at(60_000) },
			{ ...other, status: 'failed', createdAt: at(0) }
		]);

		const told = await latestDeliveries('market_vendor', ['v-1', 'v-2']);

		expect([...told]).toEqual([['v-1', 'sent']]);
	});
});
