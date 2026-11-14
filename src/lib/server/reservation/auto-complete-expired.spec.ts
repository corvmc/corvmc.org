import { describe, it, expect, vi } from 'vitest';

/**
 * Auto-complete against a real SQLite, over every combination of the columns
 * that decide whether a booking owes money. After a run, a past booking is
 * either completed or listed as payment due: nothing is left `confirmed` with
 * nobody asked to act on it (#2759).
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/db/index.js')>()),
	db: testDb
}));

const { autoCompleteExpired } = await import('./reservation-service');
const { confirmedUnpaidSql } = await import('./payment-due');
const { reservation, reservationStatuses } = await import('#lib/server/db/schema/reservation.js');
const { bookerTypes } = await import('#lib/config.js');
const { and, eq, isNull } = await import('drizzle-orm');

type Row = typeof reservation.$inferInsert;
const HOUR = 3_600_000;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

async function seed(): Promise<Row[]> {
	sqlite.exec('delete from reservation');
	const past = Date.now() - 48 * HOUR;
	const rows: Row[] = [];
	let n = 0;
	for (const status of reservationStatuses)
		for (const record of [null, 'pr_1'])
			for (const paid of [false, true])
				for (const refunded of [false, true])
					for (const cashDueCents of [null, 0, 1500])
						for (const bookerType of bookerTypes) {
							const startsAt = new Date(past - n++ * 3 * HOUR);
							rows.push({
								id: `r${n}`,
								bookerType,
								bookerId: 'b-1',
								createdByUserId: 'u-1',
								status,
								startsAt,
								endsAt: new Date(startsAt.getTime() + 2 * HOUR),
								stripePaymentRecordId: record,
								paidAt: paid ? startsAt : null,
								refundedAt: refunded ? startsAt : null,
								cashDueCents
							});
						}
	// Thirteen bound parameters a row, under D1's 100 a statement.
	for (let i = 0; i < rows.length; i += 7) {
		await testDb.insert(reservation).values(rows.slice(i, i + 7));
	}
	return rows;
}

const confirmedIds = async () =>
	ids(
		await testDb
			.select({ id: reservation.id })
			.from(reservation)
			.where(eq(reservation.status, 'confirmed'))
	);

describe('autoCompleteExpired', () => {
	it('leaves confirmed only what the payment-due list shows', async () => {
		await seed();
		await autoCompleteExpired();
		const owing = await testDb
			.select({ id: reservation.id })
			.from(reservation)
			.where(confirmedUnpaidSql());
		expect(await confirmedIds()).toEqual(ids(owing));
	});

	it('never completes a booking still owed with no payment record', async () => {
		await seed();
		const owedBefore = ids(
			await testDb
				.select({ id: reservation.id })
				.from(reservation)
				.where(and(confirmedUnpaidSql(), isNull(reservation.stripePaymentRecordId)))
		);
		await autoCompleteExpired();
		expect(owedBefore.length).toBeGreaterThan(0);
		expect(await confirmedIds()).toEqual(expect.arrayContaining(owedBefore));
	});

	it('completes paid, comped and credit-settled bookings', async () => {
		const rows = await seed();
		const settled = rows.filter(
			(r) =>
				r.status === 'confirmed' &&
				(r.stripePaymentRecordId != null || r.cashDueCents === 0 || r.paidAt != null)
		);
		await autoCompleteExpired();
		const left = new Set(await confirmedIds());
		expect(settled.filter((r) => left.has(r.id!))).toEqual([]);
	});

	it('completes an event hold that was never priced', async () => {
		const rows = await seed();
		const hold = rows.find(
			(r) =>
				r.status === 'confirmed' &&
				r.bookerType === 'production' &&
				r.cashDueCents == null &&
				r.stripePaymentRecordId == null &&
				!r.paidAt &&
				!r.refundedAt
		)!;
		await autoCompleteExpired();
		expect(await confirmedIds()).not.toContain(hold.id);
	});
});
