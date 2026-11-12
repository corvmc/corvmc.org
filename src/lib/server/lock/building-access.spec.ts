import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The sidebar's code list against a real SQLite: which rows count as active is a `WHERE`. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listActiveCodes } = await import('./building-access');
const { reservation, lockMemberCode, lockFallbackCode } =
	await import('#lib/server/db/schema/reservation.js');

const HOUR = 3_600_000;
const now = new Date('2026-06-15T19:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);

beforeEach(async () => {
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from lock_member_code');
	sqlite.exec('delete from lock_fallback_code');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('user-1', 'Iris Mendel', 'iris@example.com', 1),
			('user-2', 'Rowan Ellis', 'rowan@example.com', 1)`
	);
	const booking = (id: string, start: number, extra = {}) => ({
		id,
		bookerType: 'user' as const,
		bookerId: 'user-1',
		createdByUserId: 'user-1',
		status: 'confirmed' as const,
		startsAt: at(start),
		endsAt: at(start + 2),
		lockCode: '123456',
		...extra
	});
	await testDb
		.insert(reservation)
		.values([
			booking('on-lock', 1, { lockSyncedAt: at(-1) }),
			booking('waiting', 3),
			booking('long-over', -24),
			booking('no-code', 5, { lockCode: null }),
			booking('cancelled', 6, { status: 'cancelled' })
		]);
	await testDb.insert(lockMemberCode).values([
		{
			id: 'k1',
			userId: 'user-2',
			lockAccessId: '11',
			code: '445566',
			label: 'Rowan',
			syncedAt: now
		},
		{
			id: 'k2',
			userId: null,
			lockAccessId: '12',
			code: null,
			label: 'Old cleaner',
			adoptedAt: now
		},
		{ id: 'k3', userId: 'user-1', lockAccessId: '13', code: '1', label: 'x', revokedAt: now }
	]);
	await testDb.insert(lockFallbackCode).values([
		{ id: 'fb-active', code: '908172', syncedAt: at(-24 * 10) },
		{ id: 'fb-next', code: '334455' }
	]);
});

describe('listActiveCodes', () => {
	it('lists confirmed bookings with a code that have not ended, with their sync state', async () => {
		const { reservations } = await listActiveCodes(now);
		expect(reservations.map((r) => [r.id, r.onLock])).toEqual([
			['on-lock', true],
			['waiting', false]
		]);
	});

	it('hands out only the last two digits', async () => {
		const codes = await listActiveCodes(now);
		const all = [...codes.reservations, ...codes.keyHolders, ...codes.breakGlass];
		for (const c of all) expect(c.tail === null || c.tail.length === 2).toBe(true);
		expect(JSON.stringify(codes)).not.toContain('123456');
	});

	it('lists live key holders, adopted unassigned codes included', async () => {
		const { keyHolders } = await listActiveCodes(now);
		expect(keyHolders.map((k) => [k.name, k.adopted, k.onLock])).toEqual([
			['Old cleaner', true, false],
			['Rowan Ellis', false, true]
		]);
	});

	it('shows the break-glass code with its rotation date, and a successor waiting', async () => {
		const { breakGlass } = await listActiveCodes(now);
		expect(breakGlass.map((b) => [b.id, b.onLock])).toEqual([
			['fb-active', true],
			['fb-next', false]
		]);
		expect(breakGlass[0].rotatesAt).toEqual(at(24 * 20));
	});
});
