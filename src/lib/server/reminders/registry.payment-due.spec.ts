import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Payment reminders (#2876) end to end against a real SQLite: the registry's
 * stages, the drain's sent-marks, the dispatcher (no preference applies), the outbox
 * row and the audit row. Who is owed which stage is a `WHERE`, so nothing here
 * is a mocked `db`. Postmark is never reached: the outbox send is deferred.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/after-response.js', () => ({ afterResponse: vi.fn(async () => {}) }));

const stored = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	getConfigsByPrefix: vi.fn(async () => stored.value),
	config: vi.fn(async () => ''),
	contactEmail: async () => 'hello@example.org'
}));

const { reminders } = await import('./registry');
const { drainReminders } = await import('./drain');
const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
const { sendPaymentReminder } = await import('#lib/server/reservation/payment-reminder.js');
const { reservation } = await import('#lib/server/db/schema/reservation.js');
const { outboxMessage } = await import('#lib/server/db/schema/outbox.js');
const { auditLog } = await import('#lib/server/db/schema/audit.js');
const { reminderSent } = await import('#lib/server/db/schema/reminder.js');
const { notification, notificationPreference, preferenceTypesFor } =
	await import('#lib/server/db/schema/notification.js');

domainEvents.on('reservation.payment_due', ({ data }) => sendPaymentReminder(data));

const DAY = 86_400_000;
const NOW = new Date('2026-11-13T20:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const later = (n: number) => new Date(NOW.getTime() + n * DAY);

const stages = reminders.filter((r) => r.key.startsWith('reservation_payment_due_'));

type Row = typeof reservation.$inferInsert;
/** A two-hour session that ended `endedDaysAgo` days before NOW. */
const session = (id: string, endedDaysAgo: number, extra: Partial<Row> = {}): Row => ({
	id,
	bookerType: 'user',
	bookerId: 'user-1',
	createdByUserId: 'user-1',
	status: 'confirmed',
	startsAt: new Date(daysAgo(endedDaysAgo).getTime() - 2 * 3_600_000),
	endsAt: daysAgo(endedDaysAgo),
	cashDueCents: 3000,
	...extra
});

const insert = (...rows: Row[]) => testDb.insert(reservation).values(rows);
const drain = (at = NOW) => drainReminders(at, stages);
const marks = async () =>
	(await testDb.select().from(reminderSent))
		.map((m) => `${m.subjectId}:${m.reminderKey.replace('reservation_payment_due_', '')}`)
		.sort();
const audits = async () =>
	(await testDb.select().from(auditLog)).map((a) => ({ action: a.action, ...a.details }));

beforeEach(() => {
	for (const t of [
		'reservation',
		'reminder_sent',
		'outbox_message',
		'audit_log',
		'notification',
		'notification_preference',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('user-1', 'Iris Mendel', 'iris@example.com', 1),
			('user-2', 'Rowan Ellis', 'rowan@example.com', 1)`
	);
	// Club midnight, 2026-10-01: sessions before it are not reminded.
	stored.value = { feeGateFrom: '2026-10-01' };
});

describe('which stage a session is owed', () => {
	it('sends day 1, 7 and 21 by how long ago the session ended, one stage each', async () => {
		await insert(
			session('d1', 2),
			session('d7', 10),
			session('d21', 25),
			session('too-old', 40),
			session('today', 0.5)
		);
		await drain();
		expect(await marks()).toEqual(['d1:1d', 'd21:21d', 'd7:7d']);
	});

	it('sends nothing for a paid, comped, refunded, cancelled or event-hold session', async () => {
		await insert(
			session('paid', 2, { paidAt: daysAgo(1) }),
			session('comped', 2, { cashDueCents: 0 }),
			session('refunded', 2, { refundedAt: daysAgo(1) }),
			session('cancelled', 2, { status: 'cancelled' }),
			session('hold', 2, { bookerType: 'production', bookerId: 'prod-1' })
		);
		await drain();
		expect(await marks()).toEqual([]);
	});

	it('reminds an unpriced session, owed in full, with no amount', async () => {
		await insert(session('unpriced', 2, { cashDueCents: null }));
		await drain();
		expect(await marks()).toEqual(['unpriced:1d']);
		expect((await audits())[0]).toMatchObject({ amountCents: null, outcome: 'sent' });
	});
});

describe('the fee gate cutoff', () => {
	it('sends nothing while the cutoff is unset', async () => {
		stored.value = {};
		await insert(session('owed', 2));
		await drain();
		expect(await marks()).toEqual([]);
		expect(await audits()).toEqual([]);
	});

	it('skips a session that started before the cutoff', async () => {
		stored.value = { feeGateFrom: '2026-11-11' };
		await insert(session('before', 3), session('after', 2));
		await drain();
		expect(await marks()).toEqual(['after:1d']);
	});
});

describe('sending once', () => {
	it('sends each stage once however many drains run', async () => {
		await insert(session('owed', 2));
		await drain();
		await drain();
		await drain(new Date(NOW.getTime() + 3_600_000));
		expect(await marks()).toEqual(['owed:1d']);
		expect(await testDb.select().from(outboxMessage)).toHaveLength(1);
	});

	it('moves on to the next stage, and stops once the session is paid', async () => {
		await insert(session('owed', 2));
		await drain();
		await drain(later(6));
		expect(await marks()).toEqual(['owed:1d', 'owed:7d']);

		await testDb.update(reservation).set({ paidAt: later(7) });
		await drain(later(20));
		expect(await marks()).toEqual(['owed:1d', 'owed:7d']);
	});

	it('mails the booker a link to pay for that reservation', async () => {
		await insert(session('owed', 2));
		await drain();
		const [mail] = await testDb.select().from(outboxMessage);
		expect(mail.payload).toMatchObject({ to: 'iris@example.com' });
		expect(JSON.stringify(mail.payload)).toContain('/member/reservations/owed/pay');
	});
});

describe('the audit log', () => {
	it('records a sent reminder with its outbox row', async () => {
		await insert(session('owed', 10));
		await drain();
		const [mail] = await testDb.select().from(outboxMessage);
		const [row] = await testDb.select().from(auditLog);
		expect(row).toMatchObject({
			action: 'reservation.payment_reminder',
			subjectType: 'user',
			subjectId: 'user-1',
			actorName: 'System'
		});
		expect(row.details).toMatchObject({
			reservationId: 'owed',
			daysAfter: 7,
			amountCents: 3000,
			outcome: 'sent',
			reason: null,
			outboxId: mail.id
		});
	});

	// Mandatory (#2981): a stored opt-out, on either channel, turns nothing off.
	it('sends over a stored opt-out, and offers no preference to set', async () => {
		await testDb.insert(notificationPreference).values({
			userId: 'user-1',
			notificationType: 'reservation_payment_due',
			emailEnabled: false,
			inAppEnabled: false
		});
		await insert(session('owed', 2));
		await drain();
		const [mail] = await testDb.select().from(outboxMessage);
		expect(await audits()).toEqual([
			expect.objectContaining({ outcome: 'sent', reason: null, outboxId: mail.id })
		]);
		expect(await testDb.select().from(notification)).toHaveLength(1);
		expect(preferenceTypesFor(new Set()).map((t) => t.key)).not.toContain(
			'reservation_payment_due'
		);
	});

	it('records a skipped reminder for a removed account', async () => {
		sqlite.exec(`update user set deleted_at = 1 where id = 'user-1'`);
		await insert(session('owed', 2));
		await drain();
		expect(await testDb.select().from(outboxMessage)).toEqual([]);
		expect(await audits()).toEqual([
			expect.objectContaining({ outcome: 'skipped', reason: 'undeliverable', outboxId: null })
		]);
		// Skipped is final for the stage: it is not retried every pass.
		expect(await marks()).toEqual(['owed:1d']);
	});

	it('records a failed reminder and leaves the stage owed for the next pass', async () => {
		await insert(session('owed', 2));
		sqlite.exec('drop table outbox_message');
		try {
			const result = await drain();
			expect(result.failed).toBe(1);
		} finally {
			sqlite.exec('delete from reminder_sent');
		}
		expect(await audits()).toEqual([
			expect.objectContaining({ outcome: 'failed', reservationId: 'owed', outboxId: null })
		]);
	});
});
