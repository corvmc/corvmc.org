import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The fee gate (#2748, #2859) against a real SQLite: which rows count is a `WHERE`. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const stored = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	getConfigsByPrefix: vi.fn(async () => stored.value)
}));

const {
	getFeeGate,
	getFeeGateCutoff,
	assertFeeGateAllows,
	membersOwingFees,
	OutstandingFeesError
} = await import('./outstanding-fees');
const { reservation } = await import('#lib/server/db/schema/reservation.js');

const HOUR = 3_600_000;
const now = new Date('2026-06-15T19:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
// Ten days back: rows from -24*10 hours on count, rows before it do not.
const cutoff = at(-24 * 10);

type Row = typeof reservation.$inferInsert;
const row = (id: string, startHours: number, extra: Partial<Row> = {}): Row => ({
	id,
	bookerType: 'user',
	bookerId: 'user-1',
	createdByUserId: 'user-1',
	status: 'confirmed',
	startsAt: at(startHours),
	endsAt: at(startHours + 2),
	cashDueCents: 3000,
	...extra
});

const insert = (...rows: Row[]) => testDb.insert(reservation).values(rows);
const ids = (fees: { id: string }[]) => fees.map((f) => f.id).sort();

beforeEach(() => {
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('user-1', 'Iris Mendel', 'iris@example.com', 1),
			('user-2', 'Rowan Ellis', 'rowan@example.com', 1)`
	);
	stored.value = {};
});

describe('the cutoff setting', () => {
	it('is off while unset, so fees neither warn nor refuse', async () => {
		await insert(row('a', -48), row('b', -72));
		expect(await getFeeGateCutoff()).toBeNull();
		const gate = await getFeeGate('user-1', { now });
		expect(gate).toEqual({ state: 'off', fees: [] });
		await expect(assertFeeGateAllows('user-1')).resolves.toMatchObject({ state: 'off' });
	});

	it('reads a stored day as club midnight', async () => {
		stored.value = { feeGateFrom: '2026-06-01' };
		expect((await getFeeGateCutoff())?.toISOString()).toBe('2026-06-01T07:00:00.000Z');
	});
});

describe('what counts', () => {
	it('is clear with nothing owed', async () => {
		await insert(row('paid', -48, { paidAt: at(-47) }));
		expect((await getFeeGate('user-1', { now, cutoff })).state).toBe('clear');
	});

	it('refuses on one fee, naming it and its amount', async () => {
		await insert(row('owed', -48));
		const gate = await getFeeGate('user-1', { now, cutoff });
		expect(gate.state).toBe('refuse');
		expect(gate.fees).toEqual([
			{ id: 'owed', startsAt: at(-48), endsAt: at(-46), amountCents: 3000 }
		]);
		// Through the stored setting, as a booking reads it; every row here is long past.
		stored.value = { feeGateFrom: '2026-06-01' };
		await expect(assertFeeGateAllows('user-1')).rejects.toBeInstanceOf(OutstandingFeesError);
	});

	it('counts a band booking the member made', async () => {
		await insert(row('a', -48), row('b', -72, { bookerType: 'group', bookerId: 'band-1' }));
		const gate = await getFeeGate('user-1', { now, cutoff });
		expect(gate.state).toBe('refuse');
		expect(ids(gate.fees)).toEqual(['a', 'b']);
	});

	it('counts a payment-due row from before the cutoff as zero', async () => {
		await insert(row('old-1', -24 * 11), row('old-2', -24 * 30), row('new', -48));
		const gate = await getFeeGate('user-1', { now, cutoff });
		expect(ids(gate.fees)).toEqual(['new']);
		expect(gate.state).toBe('refuse');
	});

	it('leaves out paid, waived, refunded, cancelled and event-hold rows', async () => {
		await insert(
			row('paid', -48, { paidAt: at(-47) }),
			row('waived', -50, { cashDueCents: 0 }),
			row('refunded', -52, { refundedAt: at(-51) }),
			row('cancelled', -54, { status: 'cancelled' }),
			row('hold', -56, { bookerType: 'event_listing', bookerId: 'event-1' })
		);
		expect((await getFeeGate('user-1', { now, cutoff })).fees).toEqual([]);
	});

	it('leaves out sessions that have not ended', async () => {
		await insert(row('running', -1), row('tomorrow', 24), row('next-week', 24 * 7));
		expect((await getFeeGate('user-1', { now, cutoff })).fees).toEqual([]);
	});

	it('counts only the booking member’s own rows', async () => {
		await insert(
			row('theirs-1', -48, { createdByUserId: 'user-2', bookerId: 'user-2' }),
			row('theirs-2', -72, { createdByUserId: 'user-2', bookerId: 'user-2' })
		);
		expect((await getFeeGate('user-1', { now, cutoff })).state).toBe('clear');
		expect((await getFeeGate('user-2', { now, cutoff })).state).toBe('refuse');
	});
});

describe('staff booking on a member’s behalf', () => {
	it('shows the fees and never refuses', async () => {
		await insert(row('a', -48), row('b', -72), row('c', -96));
		const gate = await getFeeGate('user-1', { now, cutoff, onBehalf: true });
		expect(gate.state).toBe('warn');
		expect(gate.fees).toHaveLength(3);
	});
});

describe('members owing fees, for withholding door code messages', () => {
	it('names only members with a fee after the cutoff', async () => {
		await insert(
			row('owed', -48),
			row('old', -24 * 30, { createdByUserId: 'user-2', bookerId: 'user-2' }),
			row('upcoming', 24, { createdByUserId: 'user-2', bookerId: 'user-2' })
		);
		const owing = await membersOwingFees(['user-1', 'user-2'], now, cutoff);
		expect([...owing]).toEqual(['user-1']);
	});

	it('names no one once the fee is paid', async () => {
		await insert(row('owed', -48, { paidAt: at(-1) }));
		expect((await membersOwingFees(['user-1'], now, cutoff)).size).toBe(0);
	});

	it('names no one while the cutoff is unset', async () => {
		await insert(row('owed', -48));
		expect((await membersOwingFees(['user-1'], now)).size).toBe(0);
	});
});
