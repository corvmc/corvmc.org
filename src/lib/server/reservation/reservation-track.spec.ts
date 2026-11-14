import { describe, it, expect, vi } from 'vitest';

/**
 * The track's two readings against a real SQLite (#2861): every combination of
 * the columns either one looks at goes through `reservationTrack` and through
 * `reservationTrackSql`, and they must agree. A row's badge and the filter that
 * lists it are then one definition, as are Payment due and the fee gate.
 */

const { testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { confirmedUnpaidSql, paymentDueSql, reservationTrackSql } = await import('./payment-due');
const { reservation, reservationStatuses } = await import('#lib/server/db/schema/reservation.js');
const { owesMoney, reservationTrack, reservationTracks } =
	await import('#lib/utils/reservation-actions.js');
const { bookerTypes } = await import('#lib/config.js');
const { and, lt } = await import('drizzle-orm');

type Row = typeof reservation.$inferInsert;
const HOUR = 3_600_000;
const now = new Date('2026-06-15T19:00:00Z');
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

const rows: Row[] = [];
// Ended, ending this instant, and still ahead: the boundary is part of the rule.
for (const endsIn of [-48 * HOUR, 0, 48 * HOUR])
	for (const status of reservationStatuses)
		for (const paid of [false, true])
			for (const refunded of [false, true])
				for (const cashDueCents of [null, 0, 1500])
					for (const bookerType of bookerTypes) {
						const endsAt = new Date(now.getTime() + endsIn);
						rows.push({
							id: `r${rows.length}`,
							bookerType,
							bookerId: 'b-1',
							createdByUserId: 'u-1',
							status,
							startsAt: new Date(endsAt.getTime() - 2 * HOUR),
							endsAt,
							paidAt: paid ? endsAt : null,
							refundedAt: refunded ? endsAt : null,
							cashDueCents
						});
					}
// Twelve bound parameters a row, under D1's 100 a statement.
for (let i = 0; i < rows.length; i += 8) {
	await testDb.insert(reservation).values(rows.slice(i, i + 8));
}

const tracked = (r: Row) => ({
	status: r.status!,
	bookerType: r.bookerType,
	endsAt: r.endsAt,
	paidAt: r.paidAt ?? null,
	refundedAt: r.refundedAt ?? null,
	cashDueCents: r.cashDueCents ?? null
});
const viaJs = Object.fromEntries(rows.map((r) => [r.id!, reservationTrack(tracked(r), now)]));

describe('reservationTrack and reservationTrackSql', () => {
	it('agree on every combination of status, time, payment, refund, balance and booker', async () => {
		const viaSql = await testDb
			.select({ id: reservation.id, track: reservationTrackSql(now) })
			.from(reservation);
		expect(viaSql).toHaveLength(rows.length);
		expect(Object.fromEntries(viaSql.map((r) => [r.id, r.track]))).toEqual(viaJs);
	});

	it('reach every track, so no value is offered that nothing can hold', () => {
		expect([...new Set(Object.values(viaJs))].sort()).toEqual([...reservationTracks].sort());
	});

	it('read Payment due exactly where the fee gate does', async () => {
		const due = ids(rows.filter((r) => viaJs[r.id!] === 'payment_due') as { id: string }[]);
		const gate = await testDb
			.select({ id: reservation.id })
			.from(reservation)
			.where(paymentDueSql(now));
		const spelled = await testDb
			.select({ id: reservation.id })
			.from(reservation)
			.where(and(lt(reservation.endsAt, now), confirmedUnpaidSql()));
		expect(due.length).toBeGreaterThan(0);
		expect(ids(gate)).toEqual(due);
		expect(ids(spelled)).toEqual(due);
	});
});

describe('confirmedUnpaidSql and owesMoney', () => {
	it('agree on every combination', async () => {
		const viaSql = await testDb
			.select({ id: reservation.id })
			.from(reservation)
			.where(confirmedUnpaidSql());
		const owing = rows.filter((r) => owesMoney(tracked(r)));
		expect(viaSql.length).toBeGreaterThan(0);
		expect(ids(viaSql)).toEqual(ids(owing as { id: string }[]));
	});
});
