import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { user } from '#lib/server/db/schema/authentication.js';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { DomainError } from '#lib/server/domain-error.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { getReservationConfig } from './config';
import { owesMoneySql, paymentDueSql } from './payment-due';
import { buildDateInTz } from './timezone';

/**
 * Outstanding fees and the gate they drive (#2748, #2859). An outstanding fee
 * is a practice space session on the Payment due track (`paymentDueSql`, the
 * same reading the staff list filters by) that started on or after the
 * cutoff. Rows before the cutoff keep their status and count as zero. One fee
 * refuses the member's own booking and withholds their door code messages.
 */

/** At this many fees a member's own booking is refused. */
export const FEE_GATE_REFUSE_AT = 1;

export interface OutstandingFee {
	id: string;
	startsAt: Date;
	endsAt: Date;
	/** Null when the booking was never priced; it is owed in full. */
	amountCents: number | null;
}

/**
 * `off`: no cutoff set, so no gate. `clear`: nothing owed. `refuse`: the
 * member's own booking is refused. `warn`: staff booking on their behalf, who
 * see what is owed and are never refused.
 */
export type FeeGateState = 'off' | 'clear' | 'warn' | 'refuse';

export interface FeeGate {
	state: FeeGateState;
	fees: OutstandingFee[];
}

/** A member booking for themselves (or for a band) with a fee owed. */
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
				paymentDueSql(now)
			)
		)
		.orderBy(asc(reservation.startsAt));
	return rows;
}

/**
 * Outstanding fees of every member whose session ended in `[from, until)`, with
 * the booker to remind. The payment reminders read this (#2876), so a booking
 * paid, comped or refunded drops out and gets no later stage.
 */
export async function listFeesEndedBetween(from: Date, until: Date, cutoff: Date) {
	return db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			amountCents: reservation.cashDueCents,
			userId: user.id,
			userName: user.name,
			userEmail: user.email
		})
		.from(reservation)
		.innerJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				gte(reservation.startsAt, cutoff),
				gte(reservation.endsAt, from),
				lt(reservation.endsAt, until),
				owesMoneySql()
			)
		)
		.orderBy(asc(reservation.endsAt))
		.limit(500);
}

/** Staff booking on a member's behalf see the fees, but are never refused. */
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

/**
 * Which of `userIds` owe a fee now. The door code reminder drops their rows, so
 * nothing is marked sent and the next drain after payment sends it.
 */
export async function membersOwingFees(
	userIds: string[],
	now: Date,
	cutoff?: Date | null
): Promise<Set<string>> {
	const from = cutoff !== undefined ? cutoff : await getFeeGateCutoff();
	if (!from || userIds.length === 0) return new Set();
	const rows = await db
		.selectDistinct({ userId: reservation.createdByUserId })
		.from(reservation)
		.where(
			and(
				inArray(reservation.createdByUserId, [...new Set(userIds)]),
				gte(reservation.startsAt, from),
				paymentDueSql(now)
			)
		);
	return new Set(rows.map((r) => r.userId).filter((id): id is string => id !== null));
}

/**
 * Members owing a fee read no door code until they pay (#2874). Returns the
 * oldest fee's start, or null when nothing is owed or the gate is off. Every
 * member-facing remote returning a code calls this; staff surfaces do not.
 */
export async function doorCodeHeldSince(bookerId: string, now = new Date()): Promise<Date | null> {
	const gate = await getFeeGate(bookerId, { now });
	return gate.fees[0]?.startsAt ?? null;
}

/** `codeWithheld` is for the page's notice, so only on a session still to come. */
export function withholdDoorCode<T extends { lockCode: string | null; endsAt: Date }>(
	row: T,
	held: boolean,
	now = new Date()
): T & { codeWithheld: boolean } {
	if (!held) return { ...row, codeWithheld: false };
	return { ...row, lockCode: null, codeWithheld: row.endsAt > now };
}
