import { db } from '$lib/server/db';
import {
	volunteerShift,
	volunteerSignup,
	volunteerRole,
	volunteerShiftFeedback
} from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { requireActiveVolunteer } from './volunteer-profile-service';
import { VOLUNTEER_BACKDATE_LIMIT_DAYS } from '$lib/config';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { getShiftById } from './volunteer-shift-service';
import { missingRequirements } from './member-certification-service';
import type { VolunteerSignup } from '$lib/server/db/schema/volunteer';
import type { VolunteerSignupStatus } from '$lib/config';

// ---------------------------------------------------------------------------
// Signups
// ---------------------------------------------------------------------------
// One member on one shift. Claiming is the only member-initiated write; staff
// confirm, mark no-shows, and the completion sweep runs from a cron.
// ---------------------------------------------------------------------------

export class SignupNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Signup not found');
	}
}

export class ShiftFullError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('Somebody just took the last place on this shift.');
	}
}

export class ShiftClosedError extends DomainError {
	readonly httpStatus = 409;
	constructor(reason: string) {
		super(reason);
	}
}

export class NotClearedError extends DomainError {
	readonly httpStatus = 403;
	constructor(missing: { name: string }[]) {
		super(
			`This role needs ${missing.map((m) => m.name).join(' and ')} before you can work it alone. ` +
				`Talk to staff about getting cleared — you can still log hours for work you've already done.`
		);
	}
}

// ---------------------------------------------------------------------------
// Member actions
// ---------------------------------------------------------------------------

/**
 * The seats a shift has left, as a SQL predicate rather than a number read into
 * JS. Both write paths below embed it so the capacity test and the write are one
 * statement — two members claiming the last place at the same moment would both
 * pass a read-then-write check, and the unique index on (shiftId, userId) cannot
 * arbitrate that because they are different users.
 */
function hasRoomSql(shiftId: string, capacity: number) {
	return sql`(
		select count(*) from "volunteer_signup"
		where "shift_id" = ${shiftId} and "status" in ('claimed', 'confirmed', 'completed')
	) < ${capacity}`;
}

const unixNow = () => Math.floor(Date.now() / 1000);

/**
 * Claim a shift.
 *
 * Four guards, in the order that gives the most useful message: you've finished
 * onboarding, the shift is still open, you're cleared for it, and there's room.
 * The room check is part of the write (see hasRoomSql) rather than a separate
 * read, so the last place goes to exactly one of two simultaneous claimants; the
 * loser gets ShiftFullError. No transaction, per the lint rule — the conditional
 * write is what makes that safe.
 *
 * The onboarding check is here rather than only on the route because the remote
 * function is a directly callable endpoint. A route gate is a redirect for
 * somebody using a browser; it stops nothing else, and this is the check that
 * keeps an under-18 signup off a shift.
 */
export async function claimShift(shiftId: string, userId: string): Promise<VolunteerSignup> {
	await requireActiveVolunteer(userId);

	const shift = await getShiftById(shiftId);
	if (!shift) throw new SignupNotFoundError();
	if (shift.cancelledAt) throw new ShiftClosedError('That shift was called off.');
	if (shift.endsAt < new Date()) throw new ShiftClosedError('That shift has already happened.');

	// Clearance is checked against the shift's date, not today: a card that
	// lapses next week doesn't cover a shift the week after.
	const missing = await missingRequirements(userId, shift.volunteerRoleId, shift.startsAt);
	if (missing.length > 0) throw new NotClearedError(missing);

	const [existing] = await db
		.select({ id: volunteerSignup.id, status: volunteerSignup.status })
		.from(volunteerSignup)
		.where(and(eq(volunteerSignup.shiftId, shiftId), eq(volunteerSignup.userId, userId)))
		.limit(1);

	// Re-claiming after cancelling is ordinary — people change their minds — so
	// that reuses the row rather than tripping the unique index.
	if (existing) {
		if (existing.status !== 'cancelled') return reloadSignup(existing.id);

		const now = unixNow();
		// `returning "id"` rather than `*`: raw SQL hands back snake_case columns,
		// which would not match the camelCase row shape callers expect, so the
		// typed read below is what actually produces the return value.
		const revived = await db.all<{ id: string }>(sql`
			update "volunteer_signup"
			set "status" = 'claimed', "claimed_at" = ${now}, "cancelled_at" = null, "updated_at" = ${now}
			where "id" = ${existing.id} and ${hasRoomSql(shiftId, shift.capacity)}
			returning "id"
		`);

		if (revived.length === 0) throw new ShiftFullError();
		return reloadSignup(existing.id);
	}

	const now = unixNow();
	const id = crypto.randomUUID();

	try {
		// INSERT ... SELECT ... WHERE, so the row only lands if there was still
		// room at the moment it landed.
		const inserted = await db.all<{ id: string }>(sql`
			insert into "volunteer_signup"
				("id", "shift_id", "user_id", "status", "claimed_at", "created_at", "updated_at")
			select ${id}, ${shiftId}, ${userId}, 'claimed', ${now}, ${now}, ${now}
			where ${hasRoomSql(shiftId, shift.capacity)}
			returning "id"
		`);

		if (inserted.length === 0) throw new ShiftFullError();
		return reloadSignup(id);
	} catch (err) {
		if (err instanceof ShiftFullError) throw err;
		// The unique index fired — two clicks, or two tabs, from the same member.
		if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
			const [row] = await db
				.select()
				.from(volunteerSignup)
				.where(and(eq(volunteerSignup.shiftId, shiftId), eq(volunteerSignup.userId, userId)))
				.limit(1);
			if (row) return row;
		}
		throw err;
	}
}

/** Drop out. Frees the place immediately. */
export async function cancelSignup(signupId: string, userId: string): Promise<VolunteerSignup> {
	const [row] = await db
		.update(volunteerSignup)
		.set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(volunteerSignup.id, signupId),
				eq(volunteerSignup.userId, userId),
				inArray(volunteerSignup.status, ['claimed', 'confirmed'])
			)
		)
		.returning();

	if (!row) throw new SignupNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------

export async function confirmSignup(signupId: string): Promise<VolunteerSignup> {
	const [row] = await db
		.update(volunteerSignup)
		.set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(volunteerSignup.id, signupId), eq(volunteerSignup.status, 'claimed')))
		.returning();

	if (!row) throw new SignupNotFoundError();
	return row;
}

/**
 * Nobody turned up. Distinct from cancelled — a cancellation is notice, a
 * no-show is not, and only one of them is worth knowing about next time.
 */
export async function markNoShow(signupId: string): Promise<VolunteerSignup> {
	const [row] = await db
		.update(volunteerSignup)
		.set({ status: 'no_show', updatedAt: new Date() })
		.where(
			and(
				eq(volunteerSignup.id, signupId),
				inArray(volunteerSignup.status, ['claimed', 'confirmed', 'completed'])
			)
		)
		.returning();

	if (!row) throw new SignupNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// The completion sweep
// ---------------------------------------------------------------------------

export interface CompletedSignup {
	signupId: string;
	userId: string;
	userName: string;
	userEmail: string;
	shiftId: string;
	roleName: string;
	startsAt: Date;
	endsAt: Date;
}

/**
 * Move confirmed signups past their shift's end to `completed`.
 *
 * Only `confirmed` — a claim staff never confirmed is not evidence anyone
 * worked, and silently completing it would put hours in front of a member they
 * never agreed to do.
 */
export async function completeFinishedShifts(now = new Date()): Promise<CompletedSignup[]> {
	const due = await db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			userName: user.name,
			userEmail: user.email,
			shiftId: volunteerShift.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.status, 'confirmed'),
				lt(volunteerShift.endsAt, now),
				isNull(volunteerShift.cancelledAt)
			)
		);

	if (due.length === 0) return [];

	await db
		.update(volunteerSignup)
		.set({ status: 'completed', completedAt: now, updatedAt: now })
		.where(
			inArray(
				volunteerSignup.id,
				due.map((d) => d.signupId)
			)
		);

	return due;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function reloadSignup(id: string): Promise<VolunteerSignup> {
	const [row] = await db.select().from(volunteerSignup).where(eq(volunteerSignup.id, id)).limit(1);
	if (!row) throw new SignupNotFoundError();
	return row;
}

export interface ShiftClaimant {
	signupId: string;
	userId: string;
	member: MemberRef;
	status: VolunteerSignupStatus;
	claimedAt: Date;
}

export async function listClaimants(shiftId: string): Promise<ShiftClaimant[]> {
	const rows = await db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			member: memberRefColumns(),
			status: volunteerSignup.status,
			claimedAt: volunteerSignup.claimedAt
		})
		.from(volunteerSignup)
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(and(eq(volunteerSignup.shiftId, shiftId), ne(volunteerSignup.status, 'cancelled')))
		.orderBy(asc(volunteerSignup.claimedAt));

	return rows.map((row) => ({ ...row, member: toMemberRef(row.member) }));
}

/** Confirmed signups for shifts starting inside a window — the reminder cron. */
export async function listSignupsStartingBetween(from: Date, to: Date): Promise<CompletedSignup[]> {
	return db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			userName: user.name,
			userEmail: user.email,
			shiftId: volunteerShift.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.status, 'confirmed'),
				isNull(volunteerShift.cancelledAt),
				sql`${volunteerShift.startsAt} >= ${Math.floor(from.getTime() / 1000)}`,
				sql`${volunteerShift.startsAt} < ${Math.floor(to.getTime() / 1000)}`
			)
		);
}

/**
 * A member's completed shifts with no hour log yet — the pre-fill offer.
 *
 * Capped at the hour-log backdate window. Beyond it `submitHours` refuses the
 * date, so listing an older shift would leave a "Log these hours" button on the
 * page that can only ever error, with no way to dismiss it.
 */
export async function listUnloggedCompletions(userId: string) {
	const earliest = new Date(Date.now() - VOLUNTEER_BACKDATE_LIMIT_DAYS * 86_400_000);

	return db
		.select({
			signupId: volunteerSignup.id,
			shiftId: volunteerShift.id,
			volunteerRoleId: volunteerShift.volunteerRoleId,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.where(
			and(
				eq(volunteerSignup.userId, userId),
				eq(volunteerSignup.status, 'completed'),
				gte(volunteerShift.endsAt, earliest),
				sql`not exists (
					select 1 from "volunteer_hour_log" vhl
					where vhl."shift_id" = ${volunteerShift.id} and vhl."user_id" = ${userId}
				)`
			)
		)
		.orderBy(asc(volunteerShift.startsAt));
}

/**
 * Completed signups whose shift ended inside a window and that haven't been
 * asked for feedback yet — the day-after survey.
 *
 * The "no feedback row" clause is what makes the cron idempotent: a second run
 * over the same window finds nothing, so a retry can't double-ask. Asking is
 * recorded by the answer, not by a sent-flag, which means somebody who never
 * answers is asked once and then left alone.
 */
export async function listCompletionsAwaitingFeedback(
	from: Date,
	to: Date
): Promise<CompletedSignup[]> {
	return db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			userName: user.name,
			userEmail: user.email,
			shiftId: volunteerShift.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.leftJoin(volunteerShiftFeedback, eq(volunteerShiftFeedback.signupId, volunteerSignup.id))
		.where(
			and(
				eq(volunteerSignup.status, 'completed'),
				isNull(volunteerShiftFeedback.id),
				sql`${volunteerShift.endsAt} >= ${Math.floor(from.getTime() / 1000)}`,
				sql`${volunteerShift.endsAt} < ${Math.floor(to.getTime() / 1000)}`
			)
		);
}

export interface MemberSignup {
	signupId: string;
	shiftId: string;
	roleName: string;
	startsAt: Date;
	endsAt: Date;
	status: VolunteerSignupStatus;
	shiftCancelledAt: Date | null;
}

/**
 * One member's shift history, newest first.
 *
 * Cancelled signups and cancelled shifts are both included. The staff-facing
 * question this answers is usually "did they turn up?", and a record that
 * silently drops the no-shows and the withdrawals cannot answer it.
 */
export async function listSignupsForUser(
	userId: string,
	options: { limit?: number } = {}
): Promise<MemberSignup[]> {
	return db
		.select({
			signupId: volunteerSignup.id,
			shiftId: volunteerShift.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			status: volunteerSignup.status,
			shiftCancelledAt: volunteerShift.cancelledAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.where(eq(volunteerSignup.userId, userId))
		.orderBy(desc(volunteerShift.startsAt))
		.limit(options.limit ?? 20);
}
