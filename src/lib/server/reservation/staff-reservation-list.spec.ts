import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The staff Practice space list against a real SQLite: the date presets, the
 * status options and their counts are all `WHERE`s a mocked `db` would agree with.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { confirmedUnpaidSql, countOwedAfterSession, countStaffStatuses, listStaffReservations } =
	await import('./staff-reservation-list');
const { reservation, closure } = await import('#lib/server/db/schema/reservation.js');
const { owesMoney } = await import('#lib/utils/reservation-actions.js');
const { reservationStatuses } = await import('#lib/server/db/schema/reservation.js');
const { bookerTypes } = await import('#lib/config.js');

const HOUR = 3_600_000;
// Noon in Corvallis, so no preset boundary sits within a few hours of it.
const now = new Date('2026-06-15T19:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

type Row = typeof reservation.$inferInsert;
const row = (id: string, startHours: number, extra: Partial<Row> = {}): Row => ({
	id,
	bookerType: 'user',
	bookerId: 'user-1',
	createdByUserId: 'user-1',
	status: 'confirmed',
	startsAt: at(startHours),
	endsAt: at(startHours + 2),
	cashDueCents: 0,
	...extra
});

beforeEach(async () => {
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from closure');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('user-1', 'Iris Mendel', 'iris@example.com', 1),
			('user-2', 'Rowan Ellis', 'rowan@example.com', 1)`
	);
	await testDb
		.insert(reservation)
		.values([
			row('past-owed', -48, { cashDueCents: 3000, createdByUserId: 'user-2', bookerId: 'user-2' }),
			row('past-paid', -50, { paidAt: at(-49) }),
			row('long-ago', -24 * 60),
			row('today', 2, { cashDueCents: null }),
			row('next-week', 24 * 5, { status: 'waitlisted' }),
			row('far', 24 * 20, { status: 'cancelled' })
		]);
});

describe('date presets', () => {
	const list = async (range: 'from_today' | 'next_7' | 'past_30' | 'any') =>
		ids((await listStaffReservations({ range }, now)).rows);

	it('From today keeps what has not ended', async () => {
		expect(await list('from_today')).toEqual(['far', 'next-week', 'today']);
	});

	it('Next 7 days stops a week out', async () => {
		expect(await list('next_7')).toEqual(['next-week', 'today']);
	});

	it('Past 30 days keeps what started in the last 30 days', async () => {
		expect(await list('past_30')).toEqual(['past-owed', 'past-paid']);
	});

	it('Any date keeps everything', async () => {
		expect(await list('any')).toHaveLength(6);
	});

	it('a custom range takes both days whole', async () => {
		const day = (h: number) => at(h).toISOString().slice(0, 10);
		const { rows } = await listStaffReservations(
			{ range: 'custom', dateFrom: day(-50), dateTo: day(-48) },
			now
		);
		expect(ids(rows)).toEqual(['past-owed', 'past-paid']);
	});
});

describe('status', () => {
	it('Payment due is ended with money owed plus upcoming unpaid', async () => {
		const { rows } = await listStaffReservations({ range: 'any', status: 'payment_due' }, now);
		expect(ids(rows)).toEqual(['past-owed', 'today']);
	});

	it('counts what each option would list, Payment due over any date', async () => {
		expect(await countStaffStatuses({ range: 'from_today' }, now)).toEqual({
			confirmed: 1,
			payment_due: 2,
			waitlisted: 1,
			cancelled: 1
		});
	});

	it('counts under the search and booker filters', async () => {
		expect(await countStaffStatuses({ range: 'any', search: 'rowan' }, now)).toMatchObject({
			confirmed: 1,
			payment_due: 1
		});
	});

	it('the dot counts only sessions that have ended owing', async () => {
		expect(await countOwedAfterSession(now)).toBe(1);
	});
});

describe('closures', () => {
	beforeEach(async () => {
		await testDb
			.insert(closure)
			.values({ id: 'tour', reason: 'Tour', startsAt: at(4), endsAt: at(5) });
	});

	it('show under All bookers and All statuses', async () => {
		const { rows } = await listStaffReservations({}, now);
		expect(rows.map((r) => r.id)).toEqual(['today', 'tour', 'next-week', 'far']);
	});

	it('list alone under the Closures type, with no status counts (#2766)', async () => {
		const { rows, pagination } = await listStaffReservations({ bookerType: 'closure' }, now);
		expect(rows.map((r) => r.id)).toEqual(['tour']);
		expect(pagination.total).toBe(1);
		const withStatus = await listStaffReservations(
			{ bookerType: 'closure', status: 'confirmed' },
			now
		);
		expect(withStatus.rows).toEqual([]);
		expect(await countStaffStatuses({ bookerType: 'closure' }, now)).toEqual({
			confirmed: 0,
			payment_due: 0,
			waitlisted: 0,
			cancelled: 0
		});
	});

	it('leave the list under a status or a booker type', async () => {
		const byStatus = await listStaffReservations({ status: 'confirmed' }, now);
		const byBooker = await listStaffReservations({ bookerType: 'user' }, now);
		expect(byStatus.rows.some((r) => r.kind === 'closure')).toBe(false);
		expect(byBooker.rows.some((r) => r.kind === 'closure')).toBe(false);
	});
});

describe('confirmedUnpaidSql and owesMoney agree', () => {
	// Every combination of the columns either reading looks at.
	it('on every combination of status, payment, refund, balance and booker', async () => {
		sqlite.exec('delete from reservation');
		const rows: Row[] = [];
		let n = 0;
		for (const status of reservationStatuses)
			for (const paid of [false, true])
				for (const refunded of [false, true])
					for (const cashDueCents of [null, 0, 1500])
						for (const bookerType of bookerTypes)
							rows.push(
								row(`r${n++}`, n * 3, {
									status,
									bookerType,
									paidAt: paid ? now : null,
									refundedAt: refunded ? now : null,
									cashDueCents
								})
							);
		// Twelve bound parameters a row, under D1's 100 a statement.
		for (let i = 0; i < rows.length; i += 8) {
			await testDb.insert(reservation).values(rows.slice(i, i + 8));
		}
		const viaSql = await testDb
			.select({ id: reservation.id })
			.from(reservation)
			.where(confirmedUnpaidSql());
		const viaJs = rows.filter((r) =>
			owesMoney({
				status: r.status!,
				paidAt: r.paidAt,
				cashDueCents: r.cashDueCents,
				bookerType: r.bookerType,
				refundedAt: r.refundedAt ?? null
			})
		);
		expect(ids(viaSql)).toEqual(ids(viaJs as { id: string }[]));
		expect(viaSql.length).toBeGreaterThan(0);
	});
});
