import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #2874: while the booker owes a fee, member-facing reads return no door code
 * and no break-glass code. Staff keep both. Real SQLite, because who owes is a
 * `WHERE` over the reservation table.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/db/index.js')>()),
	db: testDb
}));

const stored = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	getConfigsByPrefix: vi.fn(async () => stored.value)
}));

const viewer = vi.hoisted(() => ({
	user: { id: 'owing', name: 'Owing Member', email: 'owing@example.com' },
	bandRole: 'member' as 'member' | 'staff'
}));
vi.mock('#lib/server/authorization.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/authorization.js')>()),
	can: vi.fn(async () => true),
	requireCapability: vi.fn(async () => viewer.user),
	requireUser: () => viewer.user
}));
vi.mock('#lib/server/group/group-context.js', () => ({
	requireGroupRole: vi.fn(async () => ({
		user: viewer.user,
		group: { id: 'band-1', slug: 'the-velvets', name: 'The Velvets' },
		role: viewer.bandRole
	}))
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: viewer.user },
		url: new URL('http://localhost/member/reservations')
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) =>
		Object.assign(handler, { __: { type: 'command' } }),
	form: (_schema: unknown, handler: (...args: any[]) => any) =>
		Object.assign(handler, { __: { type: 'form' }, for: () => handler }),
	query: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as any;
		return Object.assign(fn, { __: { type: 'query' }, batch: fn });
	}
}));

const remote = (await import('#lib/remote/reservations.remote.js')) as any;
const { reservation, lockFallbackCode } = await import('#lib/server/db/schema/reservation.js');

const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR);
const BREAK_GLASS = '771100';
/** Whole seconds, as the timestamp column stores them. */
const OWED_AT = new Date(Math.floor(at(-24 * 7).getTime() / 1000) * 1000);

type Row = typeof reservation.$inferInsert;
/** For `userId`: a code confirmed on the lock later today, and a session running now on the break-glass code. */
function bookings(userId: string, extra: Partial<Row> = {}): Row[] {
	const base = { bookerType: 'user' as const, bookerId: userId, createdByUserId: userId };
	return [
		{
			...base,
			id: `${userId}-synced`,
			status: 'confirmed',
			startsAt: at(3),
			endsAt: at(5),
			lockCode: '482913',
			lockSyncedAt: at(-1),
			...extra
		},
		{
			...base,
			id: `${userId}-live`,
			status: 'confirmed',
			startsAt: at(-0.5),
			endsAt: at(1.5),
			lockCode: '559201',
			...extra
		}
	];
}

beforeEach(async () => {
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from lock_fallback_code');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('owing', 'Owing Member', 'owing@example.com', 1),
			('cleared', 'Cleared Member', 'cleared@example.com', 1),
			('staff', 'Staff Member', 'staff@example.com', 1)`
	);
	// A month back, so last week's unpaid session counts.
	stored.value = {
		feeGateFrom: at(-24 * 30)
			.toISOString()
			.slice(0, 10)
	};
	await testDb.insert(lockFallbackCode).values({ code: BREAK_GLASS, syncedAt: at(-24 * 7) });
	await testDb.insert(reservation).values([
		{
			id: 'owed',
			bookerType: 'user',
			bookerId: 'owing',
			createdByUserId: 'owing',
			status: 'confirmed',
			startsAt: OWED_AT,
			endsAt: new Date(OWED_AT.getTime() + 2 * HOUR),
			cashDueCents: 3000
		},
		...bookings('owing'),
		...bookings('cleared'),
		...bookings('owing', { bookerType: 'group', bookerId: 'band-1' }).map((r) => ({
			...r,
			id: `band-${r.id}`
		}))
	]);
	viewer.user = { id: 'owing', name: 'Owing Member', email: 'owing@example.com' };
	viewer.bandRole = 'member';
});

const as = (id: string) => {
	viewer.user = { id, name: id, email: `${id}@example.com` };
};
const revealed = (id: string) =>
	(
		sqlite
			.prepare('select lock_fallback_revealed_at as at from reservation where id = ?')
			.get(id) as {
			at: number | null;
		}
	).at;

describe('member detail', () => {
	it('holds both codes from a member owing a fee, and records no reveal', async () => {
		const synced = await remote.getReservationDetail('owing-synced');
		expect(synced.reservation.lockCode).toBeNull();
		expect(synced.reservation.codeWithheld).toBe(true);
		expect(synced.paymentDueOn).toEqual(OWED_AT);

		const live = await remote.getReservationDetail('owing-live');
		expect(live.reservation.lockCode).toBeNull();
		expect(live.fallbackCode).toBeNull();
		expect(revealed('owing-live')).toBeNull();
	});

	it('gives a cleared member their code and the break-glass code', async () => {
		as('cleared');
		const synced = await remote.getReservationDetail('cleared-synced');
		expect(synced.reservation.lockCode).toBe('482913');
		expect(synced.reservation.codeWithheld).toBe(false);
		expect(synced.paymentDueOn).toBeNull();
		expect((await remote.getReservationDetail('cleared-live')).fallbackCode).toBe(BREAK_GLASS);
	});

	it('holds nothing while the cutoff is unset', async () => {
		stored.value = {};
		const synced = await remote.getReservationDetail('owing-synced');
		expect(synced.reservation.lockCode).toBe('482913');
		expect((await remote.getReservationDetail('owing-live')).fallbackCode).toBe(BREAK_GLASS);
	});
});

describe('member list', () => {
	it('carries no code on any row for a member owing a fee', async () => {
		const rows = await remote.getReservations({ includeTerminal: true });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.map((r: { lockCode: string | null }) => r.lockCode)).toEqual(rows.map(() => null));
		expect(rows.find((r: { id: string }) => r.id === 'owing-synced').codeWithheld).toBe(true);
	});

	it('carries the code for a cleared member', async () => {
		as('cleared');
		const rows = await remote.getReservations({ includeTerminal: true });
		expect(rows.find((r: { id: string }) => r.id === 'cleared-synced').lockCode).toBe('482913');
	});

	it('carries the code when staff read the owing member’s list', async () => {
		as('staff');
		const rows = await remote.getReservations({ forUser: 'owing', includeTerminal: true });
		expect(rows.find((r: { id: string }) => r.id === 'owing-synced').lockCode).toBe('482913');
	});
});

describe('band detail', () => {
	const read = (reservationId: string) =>
		remote.getBandReservationDetail({ slug: 'the-velvets', reservationId });

	it('holds both codes from every bandmate while the booker owes', async () => {
		as('cleared');
		const synced = await read('band-owing-synced');
		expect(synced.lockCode).toBeNull();
		expect(synced.codeWithheld).toBe(true);
		// The fee's date is the booker's, not the act's.
		expect(synced.paymentDueOn).toBeNull();
		expect((await read('band-owing-live')).fallbackCode).toBeNull();
	});

	it('keeps both codes for staff', async () => {
		as('staff');
		viewer.bandRole = 'staff';
		expect((await read('band-owing-synced')).lockCode).toBe('482913');
		expect((await read('band-owing-live')).fallbackCode).toBe(BREAK_GLASS);
	});
});

describe('staff detail', () => {
	it('keeps the code for a member owing a fee', async () => {
		as('staff');
		const detail = await remote.getStaffReservationDetail('owing-synced');
		expect(detail.reservation.lockCode).toBe('482913');
	});
});
