import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The class: a door code's lifecycle event that leaves no audit row. Every path
 * that assigns, clears or fails a booking's code writes exactly one row, and
 * no row carries the code, which is a secret (#3425).
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const request = vi.hoisted(() => ({
	user: null as { id: string; name: string; email: string } | null
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		if (!request.user) throw new Error('outside a request');
		return { locals: { user: request.user } };
	}
}));

vi.mock('#lib/server/kv.js', () => ({
	getJson: vi.fn().mockResolvedValue(true),
	putJson: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('#lib/server/notification/index.js', () => ({
	dispatchEmailOnly: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$app/env/private', async () => (await import('#lib/testing/env-mock.js')).envMock({}));
vi.mock('./fallback-code-service', () => ({
	maintainFallbackCode: vi.fn().mockResolvedValue({ active: null, rotated: false })
}));

const mockCreateTemporaryUser = vi.fn();
const mockRemoveTemporaryUser = vi.fn();
const mockGetLockUser = vi.fn();
vi.mock('./ultraloc-client', () => ({
	UtecRateLimitedError: class extends Error {},
	createTemporaryUser: (...args: unknown[]) => mockCreateTemporaryUser(...args),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	updateLockUser: vi.fn(),
	listLockUsers: vi.fn().mockResolvedValue([]),
	getLockUser: (...args: unknown[]) => mockGetLockUser(...args),
	queryDeviceHealth: vi
		.fn()
		.mockResolvedValue({ online: true, lockState: 'Locked', batteryLevel: 4 }),
	generateLockCode: () => 4242,
	lockDateTime: (d: Date) => d.toISOString().slice(0, 16).replace('T', ' '),
	LOCK_GRACE_MINUTES: 30
}));

const { provisionOnConfirm, reprovisionAccessFor, revokeAccessFor, runDailyLockJob } =
	await import('./lock-service');

const T0 = 1_750_000_000;
const HOUR = 3600;
const DAY = 86_400;
const TODAY = T0 - (8 * HOUR + 6 * 60 + 40);
const at = (s: number) => new Date(s * 1000);

function booking(
	id: string,
	cols: { status?: string; startsAt: number; lockCode?: string; lockAccessId?: string }
) {
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at,
			                          lock_code, lock_access_id)
			 values (?, 'user', 'user-1', 'user-1', ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			cols.status ?? 'confirmed',
			cols.startsAt,
			cols.startsAt + 2 * HOUR,
			cols.lockCode ?? null,
			cols.lockAccessId ?? null
		);
}

type Row = {
	action: string;
	actor_user_id: string | null;
	actor_name: string;
	subject_id: string;
	details: string;
};
const auditRows = () =>
	sqlite
		.prepare(
			`select action, actor_user_id, actor_name, subject_id, details from audit_log order by rowid`
		)
		.all() as Row[];

/** No row, in whole or in any field, carries a code this spec issued. */
function expectNoCode() {
	const text = JSON.stringify(auditRows());
	for (const code of ['4242', '5555']) expect(text).not.toContain(code);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(at(T0));
	request.user = null;
	for (const t of ['audit_log', 'reservation', 'user', 'lock_member_code']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite
		.prepare(`insert into user (id, name, email) values ('user-1', 'Alice', 'alice@example.com')`)
		.run();
	mockCreateTemporaryUser.mockResolvedValue(77);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
	mockGetLockUser.mockResolvedValue(null);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('door code audit trail', () => {
	it('writes one assigned row on issue, naming the lock user and never the code', async () => {
		booking('res-1', { startsAt: T0 + DAY });

		await expect(provisionOnConfirm('res-1')).resolves.toBe(true);

		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			action: 'reservation.door_code_assigned',
			actor_user_id: null,
			actor_name: 'System',
			subject_id: 'user-1'
		});
		expect(JSON.parse(rows[0].details)).toMatchObject({
			reservationId: 'res-1',
			lockAccessId: '77',
			syncedAt: null
		});
		expectNoCode();
	});

	it('names the staff member who re-issued a code', async () => {
		request.user = { id: 'user-1', name: 'Sam Staff', email: 'sam@example.com' };
		booking('res-1', { startsAt: T0 + DAY });

		await reprovisionAccessFor({
			id: 'res-1',
			startsAt: at(T0 + DAY),
			endsAt: at(T0 + DAY + 2 * HOUR),
			memberName: 'Alice'
		});

		expect(auditRows()).toMatchObject([
			{ action: 'reservation.door_code_assigned', actor_user_id: 'user-1', actor_name: 'Sam Staff' }
		]);
	});

	it('writes one failed row, and no assigned row, when the lock refuses an issue', async () => {
		booking('res-1', { startsAt: T0 + DAY });
		mockCreateTemporaryUser.mockRejectedValue(new Error('lock offline'));

		await expect(provisionOnConfirm('res-1')).resolves.toBe(false);

		const rows = auditRows();
		expect(rows.map((r) => r.action)).toEqual(['reservation.door_code_failed']);
		expect(JSON.parse(rows[0].details)).toMatchObject({ stage: 'issue', reservationId: 'res-1' });
		expectNoCode();
	});

	it('writes one cleared row when a cancellation revokes the code', async () => {
		booking('res-1', {
			status: 'cancelled',
			startsAt: T0 + DAY,
			lockCode: '5555',
			lockAccessId: '333'
		});

		await expect(revokeAccessFor('res-1')).resolves.toBe(true);

		const rows = auditRows();
		expect(rows.map((r) => r.action)).toEqual(['reservation.door_code_cleared']);
		expect(JSON.parse(rows[0].details)).toMatchObject({
			lockAccessId: '333',
			reason: 'cancelled'
		});
		expectNoCode();
	});

	it('writes one failed row, and keeps the code, when the lock refuses a removal', async () => {
		booking('res-1', {
			status: 'cancelled',
			startsAt: T0 + DAY,
			lockCode: '5555',
			lockAccessId: '333'
		});
		mockRemoveTemporaryUser.mockRejectedValue(new Error('lock offline'));
		mockGetLockUser.mockResolvedValue({ id: 333 });

		await expect(revokeAccessFor('res-1')).resolves.toBe(false);

		const rows = auditRows();
		expect(rows.map((r) => r.action)).toEqual(['reservation.door_code_failed']);
		expect(JSON.parse(rows[0].details)).toMatchObject({ stage: 'clear', lockAccessId: '333' });
		expect(
			(
				sqlite.prepare(`select lock_code from reservation where id = 'res-1'`).get() as {
					lock_code: string | null;
				}
			).lock_code
		).toBe('5555');
		expectNoCode();
	});

	it('writes one cleared row per ended booking the daily job blanks', async () => {
		booking('res-1', {
			startsAt: TODAY - DAY + 19 * HOUR,
			lockCode: '4242',
			lockAccessId: '333'
		});
		booking('res-2', { startsAt: TODAY - 2 * DAY + 19 * HOUR, lockCode: '5555' });

		await runDailyLockJob();

		const rows = auditRows();
		expect(rows.map((r) => r.action)).toEqual([
			'reservation.door_code_cleared',
			'reservation.door_code_cleared'
		]);
		expect(rows.map((r) => JSON.parse(r.details).reason)).toEqual(['ended', 'ended']);
		expect(rows.map((r) => JSON.parse(r.details).reservationId).sort()).toEqual(['res-1', 'res-2']);
		expect(
			sqlite.prepare(`select count(*) n from reservation where lock_code is not null`).get()
		).toEqual({
			n: 0
		});
		expectNoCode();
	});
});
