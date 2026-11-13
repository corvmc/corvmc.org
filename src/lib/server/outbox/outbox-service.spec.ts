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

const { mockEnv, constructed, batchSend } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	constructed: { count: 0 },
	batchSend: vi.fn()
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
		sendEmailBatch = vi.fn();
	}
}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	contactEmail: async () => 'hello@example.org'
}));

const { outboxMessage } = await import('#lib/server/db/schema/outbox.js');
const { reminderSent } = await import('#lib/server/db/schema/reminder.js');
const { emailRow } = await import('./outbox-row');
const { deliverOutbox, deliverNow, queueEmail, MAX_ATTEMPTS, backoffMs } =
	await import('./outbox-service');
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
