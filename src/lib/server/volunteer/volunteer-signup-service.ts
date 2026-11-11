import { db } from '#lib/server/db/index.js';
import {
	workOrder,
	volunteerShift,
	volunteerSignup,
	volunteerRole,
	volunteerProfile,
	volunteerHourLog,
	volunteerShiftFeedback
} from '#lib/server/db/schema/volunteer.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { containsLiteral } from '#lib/server/db/like.js';
import { DomainError } from '#lib/server/errors.js';
import {
	requireActiveVolunteer,
	VolunteerProfileBlockedError,
	VolunteerProfileNotFoundError
} from './volunteer-profile-service';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { VOLUNTEER_BACKDATE_LIMIT_DAYS } from '#lib/config.js';
import { memberRefColumns, toMemberRef } from '#lib/server/entity/refs.js';
import type { MemberRef } from '#lib/types/entity.js';
import {
	getShiftById,
	liveShift,
	notOnCancelledListing,
	openTask,
	unassignedTaskWhere,
	workOrderAuditLabel,
	type ShiftRecord
} from './work-order-service';
import { missingRequirements } from './member-certification-service';
import { listTasksWithEndedShifts } from './ended-shifts';
import { domainEvents } from '#lib/server/event-bus/event-bus.js';
import { captureException } from '#lib/server/sentry.js';
import type { VolunteerSignup } from '#lib/server/db/schema/volunteer.js';
import type { VolunteerSignupStatus } from '#lib/config.js';

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

// Signups, invitations and hour logs all hang off a role: it is what hours are
// counted against and what clearances are checked for. Work with none is a
// contractor's or not yet assigned, and nobody can be put on it this way.
export class NoVolunteerRoleError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This work order has no volunteer role, so nobody can sign up for it yet.');
	}
}

/** The work order's role, or a refusal when it has none. */
export function requireVolunteerRole(shift: { volunteerRoleId: string | null }): string {
	if (shift.volunteerRoleId === null) throw new NoVolunteerRoleError();
	return shift.volunteerRoleId;
}

export class NotClearedError extends DomainError {
	readonly httpStatus = 403;
	readonly missing: { name: string }[];

	constructor(missing: { name: string }[]) {
		const names = missing.map((m) => m.name).join(' and ');
		super(
			`This role needs ${names} before you can work it alone. ` +
				`Talk to staff about getting cleared — you can still log hours for work you've already done.`
		);
		this.missing = missing;
	}
}

/** Staff copy for a profile still in the under-18 review queue. */
export class VolunteerUnderReviewError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super(
			'Their volunteer signup is waiting on staff review (they said they are under 18). ' +
				'Review it before adding them to anything.'
		);
	}
}

/** A signup as `claimShift` returns it: what staff went over to make it, if anything. */
export type ClaimedSignup = VolunteerSignup & { warnings: string[] };

const NO_PROFILE_WARNING = 'No volunteer profile on file: never signed up to volunteer.';

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
function hasRoomSql(shift: Pick<ShiftRecord, 'id' | 'capacity' | 'startsAt' | 'endsAt'>) {
	const start = Math.floor(shift.startsAt.getTime() / 1000);
	const end = Math.floor(shift.endsAt.getTime() / 1000);

	// Counts only sign-ups whose window *overlaps* the shift's, so a 6-10 shift
	// with one place can hold somebody on 6-8 and somebody else on 8-10. With
	// nobody naming a window every coalesce lands on the shift's own times, and
	// this is the plain headcount.
	return sql`(
		select count(*) from "volunteer_signup" vs
		join "volunteer_shift" vsh on vsh."id" = vs."shift_id"
		where vs."shift_id" = ${shift.id}
			and vs."status" in ('claimed', 'confirmed', 'completed')
			and coalesce(vs."scheduled_starts_at", vsh."starts_at") < ${end}
			and coalesce(vs."scheduled_ends_at", vsh."ends_at") > ${start}
	) < ${shift.capacity}`;
}

/** Why nobody can take a place on this shift now, or null when they can. */
function closedReason(shift: ShiftRecord): string | null {
	if (shift.cancelledAt || shift.taskCancelledAt) return 'That shift was called off.';
	if (shift.taskResolvedAt) return 'That task is already done.';
	if (shift.endsAt < new Date()) return 'That shift has already happened.';
	return null;
}

const unixNow = () => Math.floor(Date.now() / 1000);

/**
 * Claim a shift.
 *
 * Four guards, ordered for the most useful message: onboarding finished, shift
 * open, cleared for it, room on it. The room check is part of the write (see
 * hasRoomSql), so the last place goes to exactly one of two simultaneous
 * claimants. Onboarding is checked here because the remote is directly callable.
 */
export async function claimShift(
	shiftId: string,
	userId: string,
	options: { assignedByStaff?: boolean } = {}
): Promise<ClaimedSignup> {
	// A staff assignment lands `confirmed`, not `claimed`: a coordinator typing the name
	// in IS the look `claimed` waits for. For staff, no profile and a missing clearance
	// warn and are recorded rather than refuse (conventions.md#workflow-gates); a member
	// claiming for themselves is still refused both.
	const assigned = options.assignedByStaff === true;
	const status: VolunteerSignupStatus = assigned ? 'confirmed' : 'claimed';
	const warnings: string[] = [];

	try {
		await requireActiveVolunteer(userId);
	} catch (err) {
		if (!assigned) throw err;
		// `blocked` is the review queue for an under-18 self-signup. Rostering a minor
		// nobody has reviewed is the integrity case, so staff are refused too.
		if (err instanceof VolunteerProfileBlockedError) throw new VolunteerUnderReviewError();
		if (!(err instanceof VolunteerProfileNotFoundError)) throw err;
		warnings.push(NO_PROFILE_WARNING);
	}

	const shift = await getShiftById(shiftId);
	if (!shift) throw new SignupNotFoundError();
	// Staff too (docs/development/conventions.md#workflow-gates): past work is an
	// hour log; a sign-up is a promise to turn up, for a night that is over. A
	// shift is open by existing, so there is no "not posted" refusal (#2518).
	const closed = closedReason(shift);
	if (closed) throw new ShiftClosedError(closed);
	const roleId = requireVolunteerRole(shift);

	// Clearance is checked against the shift's date, not today: a card that
	// lapses next week doesn't cover a shift the week after.
	const missing = await missingRequirements(userId, roleId, shift.startsAt);
	if (missing.length > 0) {
		if (!assigned) throw new NotClearedError(missing);
		const names = missing.map((m) => m.name).join(' and ');
		warnings.push(`Not cleared: no ${names} as of this shift's date.`);
	}

	const [existing] = await db
		.select({ id: volunteerSignup.id, status: volunteerSignup.status })
		.from(volunteerSignup)
		.where(and(eq(volunteerSignup.shiftId, shiftId), eq(volunteerSignup.userId, userId)))
		.limit(1);

	// Re-claiming after cancelling is ordinary — people change their minds — so
	// that reuses the row rather than tripping the unique index. An `invited` or
	// `declined` row is reused for a different reason: neither holds a place, so
	// somebody claiming a shift they were asked about is claiming it, not
	// colliding with their own invitation.
	const REUSABLE = ['cancelled', 'invited', 'declined'];
	if (existing) {
		if (!REUSABLE.includes(existing.status))
			return { ...(await reloadSignup(existing.id)), warnings: [] };

		const now = unixNow();
		// `returning "id"` rather than `*`: raw SQL hands back snake_case columns,
		// which would not match the camelCase row shape callers expect, so the
		// typed read below is what actually produces the return value.
		const revived = await db.all<{ id: string }>(sql`
			update "volunteer_signup"
			set "status" = ${status}, "claimed_at" = ${now},
				"confirmed_at" = ${assigned ? now : null},
				"cancelled_at" = null, "declined_at" = null, "updated_at" = ${now}
			where "id" = ${existing.id} and ${hasRoomSql(shift)}
			returning "id"
		`);

		if (revived.length === 0) throw new ShiftFullError();
		// Read the row back before announcing it. The event's own read joins through the
		// signup, so firing it first would race the row it is about to describe.
		const revivedRow = await reloadSignup(existing.id);
		void emitSignupEvent(
			assigned ? 'volunteer.signup_confirmed' : 'volunteer.signup_claimed',
			existing.id
		);
		if (assigned) await recordStaffAssignment(shift, userId, warnings);
		return { ...revivedRow, warnings };
	}

	const now = unixNow();
	const id = crypto.randomUUID();

	try {
		// INSERT ... SELECT ... WHERE, so the row only lands if there was still
		// room at the moment it landed.
		const inserted = await db.all<{ id: string }>(sql`
			insert into "volunteer_signup"
				("id", "shift_id", "user_id", "status", "claimed_at", "confirmed_at",
				 "created_at", "updated_at")
			select ${id}, ${shiftId}, ${userId}, ${status}, ${now}, ${assigned ? now : null},
				${now}, ${now}
			where ${hasRoomSql(shift)}
			returning "id"
		`);

		if (inserted.length === 0) throw new ShiftFullError();
		const row = await reloadSignup(id);
		void emitSignupEvent(assigned ? 'volunteer.signup_confirmed' : 'volunteer.signup_claimed', id);
		if (assigned) await recordStaffAssignment(shift, userId, warnings);
		return { ...row, warnings };
	} catch (err) {
		if (err instanceof ShiftFullError) throw err;
		// The unique index fired — two clicks, or two tabs, from the same member.
		if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
			const [row] = await db
				.select()
				.from(volunteerSignup)
				.where(and(eq(volunteerSignup.shiftId, shiftId), eq(volunteerSignup.userId, userId)))
				.limit(1);
			if (row) return { ...row, warnings: [] };
		}
		throw err;
	}
}

async function memberName(userId: string): Promise<string> {
	const [member] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return member?.name ?? 'Unknown member';
}

/**
 * Staff put somebody on the work order, from the shift page or the project's
 * picker. Over warnings, the warn-record-allow half is a second entry.
 */
async function recordStaffAssignment(
	shift: { workOrderId: string; title: string | null },
	userId: string,
	warnings: string[]
): Promise<void> {
	const task = { id: shift.workOrderId, title: shift.title };
	const subject = { type: 'work_order' as const, id: task.id, label: workOrderAuditLabel(task) };
	const name = await memberName(userId);
	await recordAuditEntry({
		action: 'work_order.member_assigned',
		subject,
		details: { userId, memberName: name }
	});
	if (warnings.length === 0) return;
	await recordAuditEntry({
		action: 'work_order.assigned_over_warnings',
		subject,
		details: { userId, memberName: name, warnings }
	});
}

/** A roster write on the work order's log, by the signup's work order and member. */
async function recordRosterEntry(
	action: 'work_order.member_unassigned' | 'work_order.member_invited',
	signup: { shiftId: string; userId: string }
): Promise<void> {
	const shift = await getShiftById(signup.shiftId);
	if (!shift) return;
	const task = { id: shift.workOrderId, title: shift.title };
	await recordAuditEntry({
		action,
		subject: { type: 'work_order', id: task.id, label: workOrderAuditLabel(task) },
		details: { userId: signup.userId, memberName: await memberName(signup.userId) }
	});
}

/**
 * Release a place on a shift, freeing it immediately.
 *
 * `owner` scopes the write to one member's own signup, so a signup id from
 * somebody else's shift is a 404. The staff path (`releaseSignup`) omits it,
 * acting on the roster rather than its own claim. Only a live claim can be
 * released: cancelling a `completed` or `no_show` signup would rewrite a fact.
 */
async function releaseSignupRow(signupId: string, owner?: string): Promise<VolunteerSignup> {
	const [row] = await db
		.update(volunteerSignup)
		.set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(volunteerSignup.id, signupId),
				owner ? eq(volunteerSignup.userId, owner) : undefined,
				inArray(volunteerSignup.status, ['claimed', 'confirmed'])
			)
		)
		.returning();

	if (!row) throw new SignupNotFoundError();
	return row;
}

/** Drop out. Frees the place immediately. */
export async function cancelSignup(signupId: string, userId: string): Promise<VolunteerSignup> {
	const row = await releaseSignupRow(signupId, userId);
	void emitSignupEvent('volunteer.signup_cancelled', signupId);
	return row;
}

// ---------------------------------------------------------------------------
// Signup events
// ---------------------------------------------------------------------------

/**
 * Announce that a signup changed hands, loading the payload the listeners need.
 *
 * Fire-and-forget: the status is already written, and a notification that fails
 * must not roll back a claim. The row is re-read rather than passed in because
 * every caller has a bare `volunteer_signup` and the listeners want the role and
 * member names — one join here instead of three call sites doing it.
 */
async function emitSignupEvent(
	event:
		| 'volunteer.signup_invited'
		| 'volunteer.signup_declined'
		| 'volunteer.signup_claimed'
		| 'volunteer.signup_confirmed'
		| 'volunteer.signup_cancelled'
		| 'volunteer.shift_cancelled',
	signupId: string
): Promise<void> {
	try {
		const [row] = await signupRows().where(eq(volunteerSignup.id, signupId)).limit(1);
		if (!row) return;

		await domainEvents.emit(event, {
			...row,
			startsAt: row.startsAt.toISOString(),
			endsAt: row.endsAt.toISOString()
		});
	} catch (err) {
		captureException(err, { event, signupId });
	}
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------

/**
 * Take somebody off a shift, on their behalf.
 *
 * The same write as a member dropping out, not a third status: the fact recorded
 * is "this place is open again". Emphatically NOT `markNoShow` — a coordinator
 * hearing "I can't make Saturday" on Thursday is being given notice, and a
 * no-show would mark somebody who did the right thing.
 */
export async function releaseSignup(signupId: string): Promise<VolunteerSignup> {
	const row = await releaseSignupRow(signupId);
	void emitSignupEvent('volunteer.signup_cancelled', signupId);
	await recordRosterEntry('work_order.member_unassigned', row);
	return row;
}

export async function confirmSignup(signupId: string): Promise<VolunteerSignup> {
	const [row] = await db
		.update(volunteerSignup)
		.set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(volunteerSignup.id, signupId), eq(volunteerSignup.status, 'claimed')))
		.returning();

	if (!row) throw new SignupNotFoundError();
	void emitSignupEvent('volunteer.signup_confirmed', signupId);
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
	/** The shift's task. */
	workOrderId: string;
	roleName: string;
	/** For `shiftLabel()`: the cron emits these straight onto the event. */
	title: string | null;
	eventTitle: string | null;
	startsAt: Date;
	endsAt: Date;
}

/**
 * Move claimed and confirmed signups past their shift's end to `completed`.
 *
 * An unconfirmed claim completes too, as worked (#1943): the person almost
 * certainly turned up, and the pre-filled hour log is how that gets recorded.
 * Marking a no-show afterwards is the correction.
 */
export async function completeFinishedShifts(now = new Date()): Promise<CompletedSignup[]> {
	const due = await signupRows().where(
		and(
			inArray(volunteerSignup.status, ['claimed', 'confirmed']),
			lt(volunteerShift.endsAt, now),
			liveShift(),
			isNull(workOrder.cancelledAt)
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

/**
 * A sign-up with its shift, task, role and member: what every shift event and
 * cron carries. Inner joins: a sign-up always has a shift, and a shift's task
 * has a role (`openShift` refuses one without).
 */
function signupRows() {
	return db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			userName: user.name,
			userEmail: user.email,
			shiftId: volunteerShift.id,
			workOrderId: workOrder.id,
			roleName: volunteerRole.name,
			title: workOrder.title,
			eventTitle: eventTitleSql,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.innerJoin(user, eq(user.id, volunteerSignup.userId));
}

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
	/** Only meaningful on a cancelled shift, where the roster is the notify list. */
	notifiedAt: Date | null;
}

export async function listClaimants(shiftId: string): Promise<ShiftClaimant[]> {
	const rows = await db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			member: memberRefColumns(),
			status: volunteerSignup.status,
			claimedAt: volunteerSignup.claimedAt,
			notifiedAt: volunteerSignup.notifiedAt
		})
		.from(volunteerSignup)
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(and(eq(volunteerSignup.shiftId, shiftId), ne(volunteerSignup.status, 'cancelled')))
		.orderBy(asc(volunteerSignup.claimedAt));

	// Deliberately unfiltered by schedule: this is everyone on one named shift,
	// and an unscheduled work order has claimants like any other row.
	return rows.map((row) => ({ ...row, member: toMemberRef(row.member) }));
}

/**
 * Tell everybody still on a called-off shift that it is off, and record it.
 *
 * Deliberately **not** run by `cancelShift`. Calling a shift off and telling six
 * people are two decisions: the first is often made in a hurry and sometimes
 * reversed. So cancelling leaves a notify list, and this is the button on it.
 * Idempotent by the `notified_at IS NULL` filter.
 */
export async function notifySignupsOfCancellation(shiftId: string): Promise<number> {
	const pending = await db
		.select({ id: volunteerSignup.id })
		.from(volunteerSignup)
		.where(
			and(
				eq(volunteerSignup.shiftId, shiftId),
				ne(volunteerSignup.status, 'cancelled'),
				isNull(volunteerSignup.notifiedAt)
			)
		);

	if (pending.length === 0) return 0;

	// One statement rather than a batch of identical ones: every row takes the
	// same stamp, and the predicate is the one the select just used.
	const now = new Date();
	await db
		.update(volunteerSignup)
		.set({ notifiedAt: now, updatedAt: now })
		.where(
			and(
				eq(volunteerSignup.shiftId, shiftId),
				ne(volunteerSignup.status, 'cancelled'),
				isNull(volunteerSignup.notifiedAt)
			)
		);

	// After the stamp, for the same reason every other emit here is: a listener
	// that throws must not leave the roster claiming nobody has been told.
	for (const { id } of pending) void emitSignupEvent('volunteer.shift_cancelled', id);

	return pending.length;
}

/**
 * "I rang them." The escape hatch beside the mail-out — staff who reached
 * somebody another way mark the row and it drops off the outstanding count.
 * Sends nothing.
 */
export async function markSignupNotified(signupId: string): Promise<void> {
	const now = new Date();
	await db
		.update(volunteerSignup)
		.set({ notifiedAt: now, updatedAt: now })
		.where(and(eq(volunteerSignup.id, signupId), isNull(volunteerSignup.notifiedAt)));
}

/** How many people on a called-off shift still have to be told. */
export async function countUnnotified(shiftId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(volunteerSignup)
		.where(
			and(
				eq(volunteerSignup.shiftId, shiftId),
				ne(volunteerSignup.status, 'cancelled'),
				isNull(volunteerSignup.notifiedAt)
			)
		);
	return Number(row?.n ?? 0);
}

/** Confirmed signups for shifts starting inside a window — the reminder cron. */
export async function listSignupsStartingBetween(from: Date, to: Date): Promise<CompletedSignup[]> {
	return signupRows().where(
		and(
			eq(volunteerSignup.status, 'confirmed'),
			liveShift(),
			isNull(workOrder.cancelledAt),
			notOnCancelledListing(),
			gte(volunteerShift.startsAt, from),
			lt(volunteerShift.startsAt, to)
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
			volunteerRoleId: volunteerRole.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
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
 * Completed signups whose shift ended inside a window and that have not been
 * asked for feedback yet — the day-after survey.
 *
 * The "no feedback row" clause makes the cron idempotent: a second run over the
 * same window finds nothing. Asking is recorded by the answer, not a sent-flag,
 * so somebody who never answers is asked once and then left alone.
 */
export async function listCompletionsAwaitingFeedback(
	from: Date,
	to: Date
): Promise<CompletedSignup[]> {
	return signupRows()
		.leftJoin(volunteerShiftFeedback, eq(volunteerShiftFeedback.signupId, volunteerSignup.id))
		.where(
			and(
				eq(volunteerSignup.status, 'completed'),
				isNull(volunteerShiftFeedback.id),
				gte(volunteerShift.endsAt, from),
				lt(volunteerShift.endsAt, to)
			)
		);
}

export interface MemberSignup {
	signupId: string;
	shiftId: string;
	workOrderId: string;
	roleName: string;
	startsAt: Date;
	endsAt: Date;
	status: VolunteerSignupStatus;
	shiftCancelledAt: Date | null;
	/** The briefing. Shown on the member's card once they are booked. */
	notes: string | null;
	eventTitle: string | null;
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
			workOrderId: workOrder.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			status: volunteerSignup.status,
			shiftCancelledAt: shiftCancelledSql,
			// The member's own card shows the briefing once they are booked — it is
			// what they need on the night, and the claim modal quotes it before they
			// commit. The event is what makes "Front Desk" mean a particular evening.
			notes: briefingSql,
			eventTitle: eventTitleSql
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(eq(volunteerSignup.userId, userId))
		.orderBy(desc(volunteerShift.startsAt))
		.limit(options.limit ?? 20);
}

/**
 * One of the member's own shifts, by signup id.
 *
 * The signup id is the scope: it names one person and one work order at once,
 * so a caller cannot reach somebody else's shift by guessing an id. The event
 * comes back as a bare id — this file knows nothing of the event schema beyond
 * the title subquery, and the caller reads the show through `event-service`.
 */
export async function getSignupForUser(signupId: string, userId: string) {
	const [row] = await db
		.select({
			signupId: volunteerSignup.id,
			shiftId: volunteerShift.id,
			workOrderId: workOrder.id,
			status: volunteerSignup.status,
			cancelledAt: volunteerSignup.cancelledAt,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			notes: briefingSql,
			shiftCancelledAt: shiftCancelledSql,
			eventId: workOrder.eventId,
			eventTitle: eventTitleSql
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(and(eq(volunteerSignup.id, signupId), eq(volunteerSignup.userId, userId)))
		.limit(1);

	return row ?? null;
}

// ---------------------------------------------------------------------------
// The coordinator's worklist
// ---------------------------------------------------------------------------
// Two reads behind the staff dashboard. Both answer "who is waiting on me",
// which no page could answer before — see
// docs/reports/volunteer-workflow-findings.md#a3.
// ---------------------------------------------------------------------------

/**
 * The show a shift staffs, as a correlated subquery rather than a fourth join.
 *
 * `work_order.event_id` is nullable by design (work parties, repair days), so a join
 * would have to be a left one, and this file otherwise knows nothing about the event
 * schema. One scalar select keeps it that way.
 */
const eventTitleSql = sql<string | null>`(
	select e."title" from "event_listing" e where e."id" = ${workOrder.eventId}
)`;

/** A shift reads as called off when it or its task was. */
const shiftCancelledSql =
	sql<Date | null>`coalesce(${volunteerShift.cancelledAt}, ${workOrder.cancelledAt})`.mapWith(
		volunteerShift.cancelledAt
	);

/** The shift's own briefing, else the task's notes. */
const briefingSql = sql<string | null>`coalesce(${volunteerShift.notes}, ${workOrder.notes})`;

export interface OutstandingClaim {
	signupId: string;
	userId: string;
	member: MemberRef;
	shiftId: string;
	workOrderId: string;
	volunteerRoleId: string;
	roleName: string;
	startsAt: Date;
	endsAt: Date;
	eventTitle: string | null;
	claimedAt: Date;
}

/** A claim still worth confirming: its shift and task are live and the shift is ahead. */
function outstandingClaimWhere(now: Date) {
	return and(liveShift(), openTask(), gte(volunteerShift.startsAt, now));
}

/**
 * Claims on shifts that have not happened yet and nobody has confirmed.
 *
 * The join is the point: "confirm this" and "this is on Saturday" are one
 * decision. Ordered by the shift rather than by when the claim arrived — the
 * soonest shift runs out of time first. Cancelled shifts are excluded; a claim
 * on one is not waiting on anybody.
 */
export async function listOutstandingClaims(
	{ before }: { before?: Date } = {},
	now = new Date()
): Promise<OutstandingClaim[]> {
	const rows = await db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			member: memberRefColumns(),
			shiftId: volunteerShift.id,
			workOrderId: workOrder.id,
			volunteerRoleId: volunteerRole.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			eventTitle: eventTitleSql,
			claimedAt: volunteerSignup.claimedAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.status, 'claimed'),
				outstandingClaimWhere(now),
				before ? lt(volunteerShift.startsAt, before) : undefined
			)
		)
		.orderBy(asc(volunteerShift.startsAt), asc(volunteerSignup.claimedAt));

	return rows.map((row) => ({ ...row, member: toMemberRef(row.member) }));
}

/**
 * How many things are waiting on a coordinator, as one number.
 *
 * The sidebar badge and the dashboard summary both read this, so nav and page
 * cannot disagree. It counts rather than lists: the badge runs on every staff
 * page load. Lapsing clearances and guardian sign-offs are deliberately absent:
 * neither is urgent, and a badge that never reaches zero stops being read.
 */
export async function countVolunteerWorkWaiting(now = new Date()): Promise<number> {
	const [pendingHours, claims, unscheduled, ended] = await Promise.all([
		db.select({ n: count() }).from(volunteerHourLog).where(eq(volunteerHourLog.status, 'pending')),
		db
			.select({ n: count() })
			.from(volunteerSignup)
			.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
			.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
			.where(and(eq(volunteerSignup.status, 'claimed'), outstandingClaimWhere(now))),
		// Unassigned tasks, by the predicate the Schedule's chip lists with.
		// Committee-owned work is on its committee's queue instead.
		db.select({ n: count() }).from(workOrder).where(unassignedTaskWhere()),
		// Open tasks whose last shift has ended: the list itself, which leaves out
		// a task whose done condition holds, so the badge cannot count one more.
		listTasksWithEndedShifts(now)
	]);

	return (
		Number(pendingHours[0]?.n ?? 0) +
		Number(claims[0]?.n ?? 0) +
		Number(unscheduled[0]?.n ?? 0) +
		ended.length
	);
}

// ---------------------------------------------------------------------------
// Who to ask
// ---------------------------------------------------------------------------
// The candidate list beside a shift's roster. Anchored on more than the
// interest table: a coordinator filling a door shift also wants the people who
// have worked it before and, when neither turns anybody up, everybody else.
// ---------------------------------------------------------------------------

export type CandidateScope = 'interested' | 'worked' | 'all';

export interface ShiftCandidate {
	userId: string;
	member: MemberRef;
	/** Free text, as the member wrote it. Null before they finish onboarding. */
	availability: string | null;
	/** Lifetime approved minutes, all roles. */
	approvedMinutes: number;
	/** Completed signups on this role — "N of these before". */
	workedThisRole: number;
	/** Their skill tags that are on the role's list. Empty when none are. */
	matchedSkills: string[];
}

const WEEKDAY_WORDS: readonly (readonly string[])[] = [
	['sunday', 'sun'],
	['monday', 'mon'],
	['tuesday', 'tue', 'tues'],
	['wednesday', 'wed'],
	['thursday', 'thu', 'thur', 'thurs'],
	['friday', 'fri'],
	['saturday', 'sat']
];

/**
 * Does a member's stated availability argue against this shift's day?
 *
 * Only a flag, never a block. The field is free text — "weekends", "Tues/Thurs
 * evenings" — so this can be wrong, and the screen says "read their note".
 * Silence is not a conflict: text naming no day returns false, because "I can do
 * evenings" tells you nothing about Saturday.
 */
export function availabilityConflictsWithDay(
	availability: string | null | undefined,
	shiftDay: number
): boolean {
	if (!availability) return false;
	const text = availability.toLowerCase();

	// The optional plural is load-bearing: people write "Fridays and Saturdays",
	// and `\bfriday\b` does not match "fridays" — there is no word boundary
	// before the s. Without it this flag silently never fired.
	const mentioned = new Set<number>();
	WEEKDAY_WORDS.forEach((words, day) => {
		if (words.some((w) => new RegExp(`\\b${w}s?\\b`).test(text))) mentioned.add(day);
	});
	if (/\bweekends?\b/.test(text)) [0, 6].forEach((d) => mentioned.add(d));
	if (/\bweekdays?\b/.test(text)) [1, 2, 3, 4, 5].forEach((d) => mentioned.add(d));

	if (mentioned.size === 0) return false;
	return !mentioned.has(shiftDay);
}

/**
 * Candidates for one shift, by scope, excluding anybody already on it.
 *
 * Active profiles only: a blocked minor cannot claim, so offering them would
 * produce a refusal. Clearance is *not* filtered — a blocked candidate is shown
 * with what they are missing, because "go and grant this" is the useful next
 * step and hiding them makes the list mysteriously short.
 */
export async function listShiftCandidates(
	on: { workOrderId: string; shiftId: string | null },
	roleId: string,
	scope: CandidateScope,
	search?: string,
	limit = 5
): Promise<ShiftCandidate[]> {
	// Not already on the shift, and not already assigned the task.
	const alreadyOn = sql`not exists (
		select 1 from "volunteer_signup" vs
		where vs."shift_id" = ${on.shiftId}
			and vs."user_id" = ${user.id}
			and vs."status" <> 'cancelled'
	) and not exists (
		select 1 from "work_order_assignee" a
		where a."work_order_id" = ${on.workOrderId} and a."user_id" = ${user.id}
	)`;

	const isInterested = sql`exists (
		select 1 from "volunteer_role_interest" vri
		where vri."user_id" = ${user.id} and vri."volunteer_role_id" = ${roleId}
	)`;

	const workedThisRoleSql = sql<number>`(
		select count(*) from "volunteer_signup" vs
		join "volunteer_shift" vsh on vsh."id" = vs."shift_id"
		join "work_order" wo on wo."id" = vsh."work_order_id"
		where vs."user_id" = ${user.id}
			and vs."status" = 'completed'
			and wo."volunteer_role_id" = ${roleId}
	)`;

	// The candidate's skill tags that appear on the role's own list (#1445).
	const skillMatchFrom = sql`from "directory_tag" dt
		join "directory_entry" de on de."id" = dt."entry_id"
		where de."user_id" = ${user.id} and dt."kind" = ${'skill'}
			and dt."value" in (
				select je."value" from "volunteer_role" vr, json_each(vr."skill_matches") je
				where vr."id" = ${roleId}
			)`;
	const skillMatchCountSql = sql<number>`(select count(*) ${skillMatchFrom})`;

	const scopeFilter =
		scope === 'interested'
			? isInterested
			: scope === 'worked'
				? sql`${workedThisRoleSql} > 0`
				: undefined;

	const rows = await db
		.select({
			userId: user.id,
			member: memberRefColumns(),
			availability: volunteerProfile.availability,
			approvedMinutes: sql<number>`(
				select coalesce(sum(vhl."minutes"), 0) from "volunteer_hour_log" vhl
				where vhl."user_id" = ${user.id} and vhl."status" = 'approved'
			)`,
			workedThisRole: workedThisRoleSql,
			matchedSkills: sql<string | null>`(select group_concat(dt."value", '|') ${skillMatchFrom})`
		})
		.from(volunteerProfile)
		.innerJoin(user, eq(user.id, volunteerProfile.userId))
		.where(
			and(
				eq(volunteerProfile.status, 'active'),
				isNull(user.deletedAt),
				alreadyOn,
				scopeFilter,
				// The desk case: somebody walks up and offers, and they are not on
				// any shortlist because they never ticked a box. Without this the
				// column can only offer the five people it already thought of.
				search
					? or(containsLiteral(user.name, search), containsLiteral(user.email, search))
					: undefined
			)
		)
		// Most-relevant first within the scope: somebody who has worked this role
		// before is a better ask than somebody who merely ticked it, and a member
		// whose skills suit the role is a better ask than one who did neither.
		.orderBy(desc(workedThisRoleSql), desc(skillMatchCountSql), asc(user.name))
		.limit(limit);

	return rows.map((r) => ({
		userId: r.userId,
		member: toMemberRef(r.member),
		availability: r.availability,
		approvedMinutes: Number(r.approvedMinutes),
		workedThisRole: Number(r.workedThisRole),
		matchedSkills: r.matchedSkills ? r.matchedSkills.split('|') : []
	}));
}

// ---------------------------------------------------------------------------
// Invitations — the chase
// ---------------------------------------------------------------------------

/**
 * Ask somebody to take a shift, without booking them onto it.
 *
 * Distinct from `claimShift(..., { assignedByStaff: true })`, which lands
 * `confirmed` because a coordinator typing a name IS the look. An invitation
 * is the question before that, and it holds no place.
 */
export class AlreadyOnShiftError extends DomainError {
	readonly httpStatus = 409;

	constructor(status: string) {
		super(
			status === 'invited'
				? 'They have already been invited to this one.'
				: 'They are already on this shift.'
		);
		this.name = 'AlreadyOnShiftError';
	}
}

export interface InviteResult {
	signupId: string;
	/**
	 * Clearances they lack for this role, as of the shift's date.
	 *
	 * A warning, not a refusal — unlike a claim. You may be inviting somebody
	 * precisely so that they get cleared, and refusing the ask would make the
	 * clearance a chicken-and-egg.
	 */
	missingCertifications: { name: string }[];
}

export async function inviteToShift(
	shiftId: string,
	userId: string,
	invitedByUserId: string
): Promise<InviteResult> {
	await requireActiveVolunteer(userId);

	const shift = await getShiftById(shiftId);
	if (!shift) throw new SignupNotFoundError();
	const closed = closedReason(shift);
	if (closed) throw new ShiftClosedError(closed);
	const roleId = requireVolunteerRole(shift);

	// No room check. Chasing four people for two places is the normal case, and
	// capacity gates claiming rather than asking.
	const missing = await missingRequirements(userId, roleId, shift.startsAt);

	const [existing] = await db
		.select({ id: volunteerSignup.id, status: volunteerSignup.status })
		.from(volunteerSignup)
		.where(and(eq(volunteerSignup.shiftId, shiftId), eq(volunteerSignup.userId, userId)))
		.limit(1);

	const now = new Date();

	if (existing) {
		// Re-inviting somebody who declined or dropped out is a real thing to
		// want — plans change — and reuses the row. Anyone holding a place is
		// already answered, so asking again is the coordinator misreading the
		// board rather than an action to take.
		if (!['cancelled', 'declined'].includes(existing.status)) {
			throw new AlreadyOnShiftError(existing.status);
		}

		await db
			.update(volunteerSignup)
			.set({
				status: 'invited',
				invitedAt: now,
				invitedByUserId,
				declinedAt: null,
				cancelledAt: null,
				updatedAt: now
			})
			.where(eq(volunteerSignup.id, existing.id));

		void emitSignupEvent('volunteer.signup_invited', existing.id);
		await recordRosterEntry('work_order.member_invited', { shiftId, userId });
		return { signupId: existing.id, missingCertifications: missing };
	}

	const [row] = await db
		.insert(volunteerSignup)
		.values({
			shiftId,
			userId,
			status: 'invited',
			invitedAt: now,
			invitedByUserId
		})
		.returning({ id: volunteerSignup.id });

	void emitSignupEvent('volunteer.signup_invited', row.id);
	await recordRosterEntry('work_order.member_invited', { shiftId, userId });
	return { signupId: row.id, missingCertifications: missing };
}

/**
 * Whether an invitation is still worth answering.
 *
 * Derived rather than stored, which is what keeps this off a cron: an
 * invitation dies when the shift starts, when it is called off, or when
 * somebody else fills the last place. All three are already columns.
 */
const invitationIsLive = sql`(
	${volunteerShift.cancelledAt} is null
	and ${workOrder.cancelledAt} is null
	and ${workOrder.resolvedAt} is null
	and ${volunteerShift.startsAt} > unixepoch()
	and (
		select count(*) from "volunteer_signup" held
		where held."shift_id" = ${volunteerShift.id}
			and held."status" in ('claimed', 'confirmed', 'completed')
	) < ${volunteerShift.capacity}
)`;

/** The invitations a member should see: theirs, unanswered, still worth answering. */
export async function listInvitationsForUser(userId: string) {
	const rows = await db
		.select({
			signupId: volunteerSignup.id,
			shiftId: volunteerShift.id,
			workOrderId: workOrder.id,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			notes: briefingSql,
			invitedAt: volunteerSignup.invitedAt,
			roleName: volunteerRole.name,
			eventTitle: eventTitleSql,
			invitedByName: sql<
				string | null
			>`(select name from "user" where "user".id = ${volunteerSignup.invitedByUserId})`
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(
			and(
				eq(volunteerSignup.userId, userId),
				eq(volunteerSignup.status, 'invited'),
				invitationIsLive
			)
		)
		.orderBy(asc(volunteerShift.startsAt));

	return rows;
}

/** The invitations outstanding on one shift, for the coordinator who sent them. */
export async function listInvitationsForShift(shiftId: string) {
	return db
		.select({
			signupId: volunteerSignup.id,
			status: volunteerSignup.status,
			invitedAt: volunteerSignup.invitedAt,
			declinedAt: volunteerSignup.declinedAt,
			member: memberRefColumns(),
			invitedByName: sql<
				string | null
			>`(select name from "user" where "user".id = ${volunteerSignup.invitedByUserId})`
		})
		.from(volunteerSignup)
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.shiftId, shiftId),
				inArray(volunteerSignup.status, ['invited', 'declined'])
			)
		)
		.orderBy(asc(volunteerSignup.invitedAt))
		.then((rows) => rows.map((r) => ({ ...r, member: toMemberRef(r.member) })));
}

/**
 * Take an invitation up. Lands `claimed`, not `confirmed`.
 *
 * Accepting is the member's act and confirming is the coordinator's, so this
 * joins the ordinary queue rather than skipping it — the same reason a claim
 * from the board does.
 */
export async function acceptInvitation(signupId: string, userId: string): Promise<VolunteerSignup> {
	const [invitation] = await db
		.select({ shiftId: volunteerSignup.shiftId })
		.from(volunteerSignup)
		.where(
			and(
				eq(volunteerSignup.id, signupId),
				eq(volunteerSignup.userId, userId),
				eq(volunteerSignup.status, 'invited')
			)
		)
		.limit(1);

	if (!invitation) throw new SignupNotFoundError();

	const shift = await getShiftById(invitation.shiftId);
	if (!shift) throw new SignupNotFoundError();
	const closed = closedReason(shift);
	if (closed) throw new ShiftClosedError(closed);

	const now = unixNow();
	// The room check runs here and not at invite time: four people can be asked
	// for two places, and the two who answer first get them.
	const taken = await db.all<{ id: string }>(sql`
		update "volunteer_signup"
		set "status" = 'claimed', "claimed_at" = ${now}, "declined_at" = null, "updated_at" = ${now}
		where "id" = ${signupId} and "status" = 'invited'
			and ${hasRoomSql(shift)}
		returning "id"
	`);

	if (taken.length === 0) throw new ShiftFullError();

	const row = await reloadSignup(signupId);
	void emitSignupEvent('volunteer.signup_claimed', signupId);
	return row;
}

/** Say no. The row stays, so the same person is not chased again by mistake. */
export async function declineInvitation(
	signupId: string,
	userId: string
): Promise<VolunteerSignup> {
	const [row] = await db
		.update(volunteerSignup)
		.set({ status: 'declined', declinedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(volunteerSignup.id, signupId),
				eq(volunteerSignup.userId, userId),
				eq(volunteerSignup.status, 'invited')
			)
		)
		.returning();

	if (!row) throw new SignupNotFoundError();
	void emitSignupEvent('volunteer.signup_declined', signupId);
	return row;
}
