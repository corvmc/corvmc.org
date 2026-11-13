import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { DomainError } from '#lib/server/domain-error.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { getReservationConfig } from './config';
import { confirmedUnpaidSql } from './staff-reservation-list';
import { buildDateInTz } from './timezone';

/**
 * Outstanding fees and the booking gate they drive (#2748). An outstanding fee
 * is a practice space session that has ended still payment due, by the same
 * `confirmedUnpaidSql` the staff list uses, and that started on or after the
 * cutoff. Rows before the cutoff keep their status and count as zero.
 */

/** Past this many fees a member's own booking is refused. */
export const FEE_GATE_REFUSE_AT = 2;

export interface OutstandingFee {
	id: string;
	startsAt: Date;
	endsAt: Date;
	/** Null when the booking was never priced; it is owed in full. */
	amountCents: number | null;
}

/**
 * `off`: no cutoff set, so no gate. `clear`: nothing owed. `warn`: book, and
 * say what is owed. `refuse`: the member's own booking is refused.
 */
export type FeeGateState = 'off' | 'clear' | 'warn' | 'refuse';

export interface FeeGate {
	state: FeeGateState;
	fees: OutstandingFee[];
}

/** A member booking for themselves (or for a band) with two or more fees owed. */
export class OutstandingFeesError extends DomainError {
	readonly httpStatus = 403;
	constructor(readonly fees: OutstandingFee[]) {
		super('Outstanding fees must be paid before booking the practice space');
		this.name = 'OutstandingFeesError';
	}
}

/** The cutoff as an instant: club midnight of the stored day, or null while unset. */
export async function getFeeGateCutoff(): Promise<Date | null> {
	const day = (await getReservationConfig()).feeGateFrom;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
	return buildDateInTz(day, '00:00', DEFAULT_TIMEZONE);
}

/** Sessions `userId` booked that have ended still payment due, oldest first. */
export async function listOutstandingFees(
	userId: string,
	now: Date,
	cutoff: Date
): Promise<OutstandingFee[]> {
	const rows = await db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			amountCents: reservation.cashDueCents
		})
		.from(reservation)
		.where(
			and(
				eq(reservation.createdByUserId, userId),
				gte(reservation.startsAt, cutoff),
				lt(reservation.endsAt, now),
				confirmedUnpaidSql()
			)
		)
		.orderBy(asc(reservation.startsAt));
	return rows;
}

/** Staff booking on a member's behalf see the count, but are never refused. */
export function feeGateState(
	feeCount: number,
	opts: { cutoff: Date | null; onBehalf?: boolean }
): FeeGateState {
	if (!opts.cutoff) return 'off';
	if (feeCount === 0) return 'clear';
	if (feeCount >= FEE_GATE_REFUSE_AT && !opts.onBehalf) return 'refuse';
	return 'warn';
}

/**
 * The gate for one member. The member is the booking's creating user: a band
 * booking is gated on the booking member's own fees, not the band's.
 */
export async function getFeeGate(
	userId: string,
	opts: { now?: Date; onBehalf?: boolean; cutoff?: Date | null } = {}
): Promise<FeeGate> {
	const cutoff = opts.cutoff !== undefined ? opts.cutoff : await getFeeGateCutoff();
	if (!cutoff) return { state: 'off', fees: [] };
	const fees = await listOutstandingFees(userId, opts.now ?? new Date(), cutoff);
	return { state: feeGateState(fees.length, { cutoff, onBehalf: opts.onBehalf }), fees };
}

/** The check every member booking path makes before writing. */
export async function assertFeeGateAllows(userId: string): Promise<FeeGate> {
	const gate = await getFeeGate(userId);
	if (gate.state === 'refuse') throw new OutstandingFeesError(gate.fees);
	return gate;
}
