/**
 * Reservation credit policy: free-hour credits are committed (deducted) exactly
 * once, at Confirm time, tagged to the reservation in the credit ledger
 * (`source: 'reservation'`, `sourceId: reservationId`). The committed cash
 * remainder is stored on `reservation.cashDueCents` (the commitment marker:
 * null = not committed). Credits are reversed once on cancel.
 *
 * This keeps reservation-specific credit rules out of the generic credit- and
 * payment-services.
 */
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { creditTransaction } from '$lib/server/db/schema/finance';
import { user, type Subscription } from '$lib/server/db/schema/authentication';
import { and, eq, sql } from 'drizzle-orm';
import * as creditService from '$lib/server/finance/credit-service';
import { creditValueCents, creditsToHours, hoursToCredits } from '$lib/config';

export interface ReservationCreditResult {
	/** Free-hour credit units applied to this reservation (committed or already-committed). */
	creditUnits: number;
	/** Cents covered by the applied credits. */
	creditDiscountCents: number;
	/** Cash still owed after credits (what `cashDueCents` is set to). */
	remainingCents: number;
	/** True when a prior commit existed and nothing was deducted this call. */
	alreadyCommitted: boolean;
}

/**
 * Pure pricing: how many free-hour credits apply to a reservation total, and the
 * resulting cash remainder. Single source of truth shared by display
 * (`getReservationPricing`) and settlement (`commitReservationCredits`) so the
 * member is never shown a different remainder than they're charged.
 */
export function computeReservationCredit(params: {
	totalCents: number;
	durationHours: number;
	hourlyRateCents: number;
	freeHoursBalance: number;
}): { creditUnits: number; creditDiscountCents: number; remainingCents: number } {
	const { totalCents, durationHours, hourlyRateCents, freeHoursBalance } = params;
	const unitValue = creditValueCents(hourlyRateCents);
	const unitsNeeded = hoursToCredits(durationHours);
	const creditUnits = Math.max(0, Math.min(freeHoursBalance, unitsNeeded));
	const creditDiscountCents = Math.min(creditUnits * unitValue, totalCents);
	const remainingCents = totalCents - creditDiscountCents;
	return { creditUnits, creditDiscountCents, remainingCents };
}

/**
 * When the member's free hours next reset: the date "Resets to N on <date>"
 * shows. Null without a subscription, and then free hours apply to nothing.
 */
export function freeHoursResetAt(sub: Subscription | null | undefined): Date | null {
	return sub?.creditsResetAt ? new Date(sub.creditsResetAt) : null;
}

/**
 * Free hours pay only for a session that starts before the next reset. The
 * reset overwrites the balance, so spending it on a later session would carry
 * this period's hours into the next one.
 */
export function freeHoursApplyTo(startsAt: Date, resetAt: Date | null): boolean {
	return resetAt != null && startsAt.getTime() < resetAt.getTime();
}

export interface FreeHoursWallet {
	balance: number;
	resetAt: Date | null;
}

/** The member's free-hour balance and the reset that bounds it. */
export async function getFreeHoursWallet(userId: string): Promise<FreeHoursWallet> {
	const [row] = await db
		.select({ subscription: user.subscription })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const resetAt = freeHoursResetAt(row?.subscription as Subscription | null);
	return { balance: await creditService.getBalance(userId, 'free_hours'), resetAt };
}

/** The part of the wallet a session starting at `startsAt` may spend. */
export function usableFreeHours(wallet: FreeHoursWallet, startsAt: Date): number {
	return freeHoursApplyTo(startsAt, wallet.resetAt) ? wallet.balance : 0;
}

/** Sum the free-hour credit units already committed to a reservation (ledger-driven). */
async function sumCommittedUnits(reservationId: string): Promise<number> {
	const [row] = await db
		.select({ units: sql<number>`coalesce(-sum(${creditTransaction.amount}), 0)` })
		.from(creditTransaction)
		.where(
			and(
				eq(creditTransaction.source, 'reservation'),
				eq(creditTransaction.sourceId, reservationId),
				eq(creditTransaction.creditType, 'free_hours')
			)
		);
	return row?.units ?? 0;
}

/**
 * Commit free-hour credits to a reservation exactly once. Idempotent: if the
 * reservation has already been committed (`cashDueCents` is non-null), nothing is
 * deducted and the existing remainder is returned — so Confirm → Pay-Ahead and
 * Confirm → Cash-Received never double-deduct. On first commit it deducts the
 * applicable credits and sets `reservation.cashDueCents = remainingCents`.
 */
export async function commitReservationCredits(params: {
	userId: string;
	reservationId: string;
	totalCents: number;
	durationHours: number;
	hourlyRateCents: number;
}): Promise<ReservationCreditResult> {
	const { userId, reservationId, totalCents, durationHours, hourlyRateCents } = params;

	const [row] = await db
		.select({ cashDueCents: reservation.cashDueCents, startsAt: reservation.startsAt })
		.from(reservation)
		.where(eq(reservation.id, reservationId))
		.limit(1);
	if (!row) throw new Error(`Reservation ${reservationId} not found`);

	if (row.cashDueCents !== null) {
		const committedUnits = await sumCommittedUnits(reservationId);
		return {
			creditUnits: committedUnits,
			creditDiscountCents: totalCents - row.cashDueCents,
			remainingCents: row.cashDueCents,
			alreadyCommitted: true
		};
	}

	const freeHoursBalance = usableFreeHours(await getFreeHoursWallet(userId), row.startsAt);
	const { creditUnits, creditDiscountCents, remainingCents } = computeReservationCredit({
		totalCents,
		durationHours,
		hourlyRateCents,
		freeHoursBalance
	});

	if (creditUnits > 0) {
		await creditService.deductCredits(
			userId,
			'free_hours',
			creditUnits,
			'reservation',
			reservationId,
			`${creditUnits} free_hours applied to reservation`
		);
	}

	await db
		.update(reservation)
		.set({
			cashDueCents: remainingCents,
			// Record applied credits (in hours) for partial coverage too — the
			// fully-covered settle path writes the same value, but without this a
			// partially covered reservation under-reports credit usage in staff views.
			creditsUsed: creditUnits > 0 ? creditsToHours(creditUnits) : null,
			updatedAt: new Date()
		})
		.where(eq(reservation.id, reservationId));

	return { creditUnits, creditDiscountCents, remainingCents, alreadyCommitted: false };
}

/**
 * Reverse the free-hour credits committed to a reservation, exactly once.
 * No-op when nothing was committed (e.g. comped reservations, or legacy
 * reservations whose credits live under a Stripe payment record instead).
 *
 * The reversal is capped so the resulting balance never exceeds the member's
 * current monthly allocation (`subscription.hoursPerReset`, in credits). Free
 * hours have no rollover: the monthly `invoice.paid` reset overwrites the
 * balance, so an uncapped reversal after a reset would mint credits on top of
 * a full allocation (confirm → reset → cancel). Non-subscribers reverse to 0 —
 * their wallet was already reset by `subscription.deleted`.
 */
export async function reverseReservationCredits(
	userId: string,
	reservationId: string
): Promise<void> {
	// Idempotency guard: don't reverse twice across retried cancels.
	if (await creditService.hasTransaction('cancelled', reservationId, 'free_hours')) return;

	const units = await sumCommittedUnits(reservationId);
	if (units <= 0) return;

	const [row] = await db
		.select({ subscription: user.subscription })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const allocation = (row?.subscription as Subscription | null)?.hoursPerReset ?? 0;
	const balance = await creditService.getBalance(userId, 'free_hours');
	const unitsToAdd = Math.min(units, Math.max(0, allocation - balance));

	if (unitsToAdd > 0) {
		await creditService.addCredits(
			userId,
			'free_hours',
			unitsToAdd,
			'cancelled',
			reservationId,
			`Reversed ${unitsToAdd} free_hours from cancelled reservation`
		);
	}
}
