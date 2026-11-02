import { db } from '$lib/server/db';
import { doorAccess, reservation } from '$lib/server/db/schema/reservation';
import { group, groupMember } from '$lib/server/db/schema/group';
import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { config } from '$lib/server/site-config/site-config-service';
import { DOOR_WINDOW_LEAD_MINUTES, type DoorAccessKind, type DoorAccessOutcome } from '$lib/config';
import { operateDoor, type OperateOptions } from './door-command-service';
import {
	claimPoolCode,
	poolCodeFor,
	revealPoolCode,
	settleBookingCode
} from './fallback-code-service';

// The back-door page (#2120). Who: the booker, or any active member of the
// band it was booked for — the same rule as paying for it (#2095). When: from
// `DOOR_WINDOW_LEAD_MINUTES` before the start until the end. The pool code is
// claimed on load and sent with the page, so a phone that loses signal at the
// door can still show it (#2157).

export class DoorBookingClosedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This booking is not open at the door right now.');
	}
}

export class DoorCheckedOutError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This booking has already checked out.');
	}
}

const leadMs = DOOR_WINDOW_LEAD_MINUTES * 60_000;

export interface DoorBooking {
	id: string;
	startsAt: Date;
	endsAt: Date;
	bandName: string | null;
}

/** Bands the member belongs to, as the booker id a group booking carries. */
async function bandIdsFor(userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: groupMember.groupId })
		.from(groupMember)
		.where(and(eq(groupMember.userId, userId), eq(groupMember.status, 'active')));
	return rows.map((r) => r.id);
}

/** Booked by the member, or for a band they are an active member of. */
async function bookedBy(userId: string) {
	const bands = await bandIdsFor(userId);
	return or(
		eq(reservation.createdByUserId, userId),
		bands.length
			? and(eq(reservation.bookerType, 'group'), inArray(reservation.bookerId, bands))
			: undefined
	);
}

/** The member's next confirmed booking that has not ended. */
async function bookingsFor(userId: string, now: Date, openOnly: boolean): Promise<DoorBooking[]> {
	const mine = await bookedBy(userId);
	return db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			bandName: group.name
		})
		.from(reservation)
		.leftJoin(group, and(eq(reservation.bookerType, 'group'), eq(group.id, reservation.bookerId)))
		.where(
			and(
				eq(reservation.status, 'confirmed'),
				gte(reservation.endsAt, now),
				openOnly ? lte(reservation.startsAt, new Date(now.getTime() + leadMs)) : undefined,
				mine
			)
		)
		.orderBy(asc(reservation.startsAt), asc(reservation.id))
		.limit(1);
}

/** The booking whose door window is open for this member now, or null. */
export async function findOpenBooking(
	userId: string,
	now: Date = new Date()
): Promise<DoorBooking | null> {
	const [open] = await bookingsFor(userId, now, true);
	return open ?? null;
}

async function attemptsFor(reservationId: string) {
	return db
		.select({ kind: doorAccess.kind, createdAt: doorAccess.createdAt })
		.from(doorAccess)
		.where(eq(doorAccess.reservationId, reservationId))
		.orderBy(asc(doorAccess.createdAt), asc(doorAccess.id));
}

function firstOf(rows: { kind: DoorAccessKind; createdAt: Date }[], kind: DoorAccessKind) {
	return rows.find((r) => r.kind === kind)?.createdAt ?? null;
}

export interface DoorState {
	booking: DoorBooking | null;
	/** The next booking when none is open yet, so the page can say when. */
	next: { startsAt: Date; opensAt: Date } | null;
	checkedInAt: Date | null;
	checkedOutAt: Date | null;
	/** Pre-loaded; the page shows it only once an unlock fails. */
	code: string | null;
	codeRevealed: boolean;
	poolEmpty: boolean;
	checkoutTasks: string[];
}

/** What `/door` renders. Claims the booking's pool code the first time. */
export async function getDoorState(userId: string, now: Date = new Date()): Promise<DoorState> {
	const booking = await findOpenBooking(userId, now);
	const checkoutTasks = String(await config('venue.checkoutTasks'))
		.split('\n')
		.map((t) => t.trim())
		.filter(Boolean);

	const empty = {
		checkedInAt: null,
		checkedOutAt: null,
		code: null,
		codeRevealed: false,
		poolEmpty: false,
		checkoutTasks
	};

	if (!booking) {
		const [upcoming] = await bookingsFor(userId, now, false);
		const next =
			upcoming && upcoming.startsAt > now
				? { startsAt: upcoming.startsAt, opensAt: new Date(upcoming.startsAt.getTime() - leadMs) }
				: null;
		return { booking: null, next, ...empty };
	}

	const attempts = await attemptsFor(booking.id);
	const checkedOutAt = firstOf(attempts, 'check_out');
	const code = checkedOutAt ? await poolCodeFor(booking.id) : await claimPoolCode(booking.id, now);

	return {
		booking,
		next: null,
		checkedInAt: firstOf(attempts, 'check_in'),
		checkedOutAt,
		code: checkedOutAt ? null : (code?.code ?? null),
		codeRevealed: Boolean(code?.revealedAt),
		poolEmpty: !checkedOutAt && !code,
		checkoutTasks
	};
}

/** The member's open booking, which must be the one they asked about. */
async function requireOpenBooking(userId: string, reservationId: string, now: Date) {
	const booking = await findOpenBooking(userId, now);
	if (!booking || booking.id !== reservationId) throw new DoorBookingClosedError();
	const attempts = await attemptsFor(booking.id);
	if (firstOf(attempts, 'check_out')) throw new DoorCheckedOutError();
	return { booking, attempts };
}

async function log(
	reservationId: string,
	userId: string,
	kind: DoorAccessKind,
	outcome: DoorAccessOutcome,
	codeRevealed: boolean
) {
	await db.insert(doorAccess).values({ reservationId, userId, kind, outcome, codeRevealed });
}

export interface DoorAttempt {
	kind: DoorAccessKind;
	outcome: DoorAccessOutcome;
	/** Set when the unlock did not confirm, so the page shows the keypad code. */
	code: string | null;
}

/**
 * Check in, or re-enter once checked in: unlock, and reveal the booking's code
 * when the lock does not confirm. Recorded whatever the lock did.
 */
export async function openDoor(
	userId: string,
	reservationId: string,
	opts: OperateOptions & { now?: Date } = {}
): Promise<DoorAttempt> {
	const now = opts.now ?? new Date();
	const { attempts } = await requireOpenBooking(userId, reservationId, now);
	const kind: DoorAccessKind = firstOf(attempts, 'check_in') ? 're_entry' : 'check_in';

	const { outcome } = await operateDoor('unlock', opts);
	const code = outcome === 'unlocked' ? null : await revealPoolCode(reservationId, now);

	await log(reservationId, userId, kind, outcome, Boolean(code));
	return { kind, outcome, code: code?.code ?? null };
}

/** Lock up and record it, then return or burn the booking's code. */
export async function checkOut(
	userId: string,
	reservationId: string,
	opts: OperateOptions & { now?: Date } = {}
): Promise<DoorAttempt> {
	const now = opts.now ?? new Date();
	await requireOpenBooking(userId, reservationId, now);

	const { outcome } = await operateDoor('lock', opts);
	await log(reservationId, userId, 'check_out', outcome, false);
	await settleBookingCode(reservationId, []);
	return { kind: 'check_out', outcome, code: null };
}

/**
 * The page showed the pre-loaded code without reaching us — no signal at the
 * door — and says so once it can. Late is fine: a revealed code is burned,
 * not reused, whether or not the window is still open.
 */
export async function recordOfflineReveal(
	userId: string,
	reservationId: string,
	now: Date = new Date()
): Promise<void> {
	const [owned] = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(and(eq(reservation.id, reservationId), await bookedBy(userId)))
		.limit(1);
	if (!owned || !(await poolCodeFor(reservationId))) return;
	await revealPoolCode(reservationId, now);
}
