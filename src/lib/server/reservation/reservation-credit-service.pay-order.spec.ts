import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * #2108: a booking holds no free hours, so two bookings can each read as
 * covered against the same balance. Whichever is paid first takes the hours,
 * and the other is priced from what is left when it is paid. Real SQLite,
 * because the balance and the ledger are what is under test.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { commitReservationCredits, coveredByFreeHours, getFreeHoursWallet } =
	await import('./reservation-credit-service');
const { user } = await import('$lib/server/db/schema/authentication');
const { reservation } = await import('$lib/server/db/schema/reservation');
const { db } = await import('$lib/server/db');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RATE = 1500;
const cfg = { hourlyRateCents: RATE } as Parameters<typeof coveredByFreeHours>[2];

const resetAt = new Date(Date.now() + 20 * DAY);
const first = { id: 'res-a', startsAt: new Date(Date.now() + 5 * DAY) };
const second = { id: 'res-b', startsAt: new Date(Date.now() + 6 * DAY) };

beforeEach(async () => {
	sqlite.exec('delete from credit_transaction');
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from user');
	await db.insert(user).values({
		id: 'user-1',
		name: 'Member',
		email: 'member@example.com',
		// Two hours, in 30-minute credits.
		creditFreeHours: 4,
		subscription: { hoursPerReset: 8, creditsResetAt: resetAt.toISOString() } as never
	});
	for (const r of [first, second]) {
		await db.insert(reservation).values({
			id: r.id,
			bookerType: 'user',
			bookerId: 'user-1',
			createdByUserId: 'user-1',
			status: 'scheduled',
			startsAt: r.startsAt,
			endsAt: new Date(r.startsAt.getTime() + 2 * HOUR)
		});
	}
});

const asBooking = (r: { startsAt: Date }) => ({
	startsAt: r.startsAt,
	endsAt: new Date(r.startsAt.getTime() + 2 * HOUR),
	bookerType: 'user' as const
});

const pay = (id: string) =>
	commitReservationCredits({
		userId: 'user-1',
		reservationId: id,
		totalCents: 2 * RATE,
		durationHours: 2,
		hourlyRateCents: RATE
	});

describe('free hours go to the booking paid first', () => {
	it('shows both bookings as covered while neither is paid', async () => {
		const wallet = await getFreeHoursWallet('user-1');
		expect(coveredByFreeHours(asBooking(first), wallet, cfg)).toBe(true);
		expect(coveredByFreeHours(asBooking(second), wallet, cfg)).toBe(true);
	});

	it('prices the second booking with cash due once the first takes the hours', async () => {
		// The later session paid first: order of payment, not of booking, decides.
		expect(await pay(second.id)).toMatchObject({ creditUnits: 4, remainingCents: 0 });
		expect(await pay(first.id)).toMatchObject({ creditUnits: 0, remainingCents: 3000 });

		const wallet = await getFreeHoursWallet('user-1');
		expect(wallet.balance).toBe(0);
		expect(coveredByFreeHours(asBooking(first), wallet, cfg)).toBe(false);
	});

	it('does not price an already-priced booking again', async () => {
		await pay(first.id);
		expect(await pay(first.id)).toMatchObject({ alreadyCommitted: true, remainingCents: 0 });
		expect((await getFreeHoursWallet('user-1')).balance).toBe(0);
	});
});
