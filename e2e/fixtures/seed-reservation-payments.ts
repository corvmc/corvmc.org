/**
 * Seed one member plus four upcoming reservations covering every shape the
 * staff Payment column can render.
 *
 * The column used to print a single gross figure — duration × hourly rate — so
 * a booking settled entirely in credits still advertised its full list price.
 * Splitting it into cash and credits introduced branches (drop the dollars,
 * drop the credits, show both) that no fixture exercised: the dev seed left
 * `creditsUsed` null on every row, so locally the column only ever took the
 * cash-only path.
 *
 * The four rows below pin one branch each, including a fractional credit —
 * the venue books in 30-minute blocks, so half credits are ordinary.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 * Idempotent: deletes and recreates its user and reservations on every run.
 *
 * Mirrors the D1 access pattern in seed-pay-reservation.ts.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { user } from '../../src/lib/server/db/schema/authentication';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { withPlatformDb } from './platform-db';

export const SEED_PAYMENTS_USER_ID = 'e2e-payment-breakdown-user';
export const SEED_PAYMENTS_EMAIL = 'e2e.payment.breakdown@example.com';

/** Distinctive enough that the list's search box isolates exactly these rows. */
export const SEED_PAYMENTS_NAME = 'Zeta Paymentbreakdown';

/** The `reservation.hourlyRateCents` site-config default the preview server runs with. */
const HOURLY_RATE_CENTS = 1500;

const HOUR = 60 * 60 * 1000;

/**
 * Each case states the cell it should produce. `creditsUsed` is denominated in
 * hours (one credit buys one hour of room time) and `cashDueCents` freezes the
 * remainder, exactly as `commitReservationCredits` writes them.
 */
export const PAYMENT_CASES = [
	{
		id: 'e2e-payment-cash-only',
		hours: 2,
		creditsUsed: null,
		cashDueCents: null,
		expected: '$30.00'
	},
	{
		id: 'e2e-payment-mixed-whole',
		hours: 2,
		creditsUsed: 1,
		cashDueCents: 1500,
		expected: '$15.00, 1cr'
	},
	{
		id: 'e2e-payment-mixed-half',
		hours: 1.5,
		creditsUsed: 0.5,
		cashDueCents: 1500,
		expected: '$15.00, 0.5cr'
	},
	{
		id: 'e2e-payment-credits-only',
		hours: 2,
		creditsUsed: 2,
		cashDueCents: 0,
		expected: '2cr'
	},
	// Comped: `cashDueCents` 0 with no credits recorded. Staff still want the
	// room time's cash value on screen, struck through rather than dropped.
	{
		id: 'e2e-payment-comped',
		hours: 2,
		creditsUsed: null,
		cashDueCents: 0,
		expected: '$30.00'
	}
] as const;

/** The case whose amount renders struck through. */
export const COMPED_CASE_INDEX = 4;

const ALL_IDS = PAYMENT_CASES.map((c) => c.id);

export async function seedReservationPayments(): Promise<void> {
	await withPlatformDb(async (db) => {
		// Clean slate. Delete explicitly (FKs may be disabled on local D1).
		await db.delete(reservation).where(inArray(reservation.id, ALL_IDS));
		await db.delete(user).where(eq(user.id, SEED_PAYMENTS_USER_ID));

		const now = new Date();
		await db.insert(user).values({
			id: SEED_PAYMENTS_USER_ID,
			name: SEED_PAYMENTS_NAME,
			email: SEED_PAYMENTS_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		// Well clear of "now" in both directions: far enough ahead that the
		// default Upcoming tab keeps them, and spaced an hour apart so the list's
		// startsAt ordering matches PAYMENT_CASES.
		for (const [i, c] of PAYMENT_CASES.entries()) {
			const startsAt = new Date(now.getTime() + (48 + i) * HOUR);
			await db.insert(reservation).values({
				id: c.id,
				bookerType: 'user',
				bookerId: SEED_PAYMENTS_USER_ID,
				createdByUserId: SEED_PAYMENTS_USER_ID,
				status: 'confirmed',
				startsAt,
				endsAt: new Date(startsAt.getTime() + c.hours * HOUR),
				notes: 'E2E payment breakdown',
				creditsUsed: c.creditsUsed,
				cashDueCents: c.cashDueCents,
				// Left unpaid across the board: `paidAt` would mask the cash-due and
				// credit-settled states behind a plain "Paid", and the amount itself
				// is what these cases assert.
				paidAt: null,
				createdAt: now,
				updatedAt: now
			});
		}
	});
}

/** Sanity-check the fixture's own arithmetic against the rate it assumes. */
export function expectedCashCents(hours: number, creditsUsed: number | null): number {
	const total = Math.round(hours * HOURLY_RATE_CENTS);
	return total - Math.min(Math.round((creditsUsed ?? 0) * HOURLY_RATE_CENTS), total);
}
