import { db } from '$lib/server/db';
import {
	volunteerShift,
	volunteerSignup,
	volunteerRole,
	volunteerProfile,
	volunteerHourLog,
	volunteerShiftFeedback
} from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { requireActiveVolunteer } from './volunteer-profile-service';
import { VOLUNTEER_BACKDATE_LIMIT_DAYS } from '$lib/config';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { getShiftById } from './volunteer-shift-service';
import { missingRequirements } from './member-certification-service';
import { isScheduled } from './scheduled';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
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
	/** Kept on the error so a caller can reword the refusal for its own audience. */
	readonly missing: { name: string }[];

	constructor(missing: { name: string }[], audience: 'member' | 'staff' = 'member') {
		const names = missing.map((m) => m.name).join(' and ');
		// Same refusal, two readers. The member's copy tells them what to go and get; a
		// coordinator being told to "talk to staff" is being told to talk to themselves,
		// and the useful next step for them is the grant form on the member's page.
		super(
			audience === 'staff'
				? `They don't hold ${names} as of this shift's date. Grant it from their member page, then add them.`
				: `This role needs ${names} before you can work it alone. ` +
						`Talk to staff about getting cleared — you can still log hours for work you've already done.`
		);
		this.missing = missing;
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
export async function claimShift(
	shiftId: string,
	userId: string,
	options: { assignedByStaff?: boolean } = {}
): Promise<VolunteerSignup> {
	// A staff assignment lands `confirmed`, not `claimed`. `claimed` means "somebody put
	// their hand up and a coordinator has not looked yet", and a coordinator typing the
	// name in IS that look — leaving it `claimed` would file work into their own queue and
	// cost the member the day-before reminder until they cleared it. Same call as the one
	// a staff-entered hour log makes.
	//
	// Every guard above still applies, clearance included: refusing to roster somebody the
	// system says is not cleared is the whole point of recording clearances, and the
	// refusal names what is missing so the coordinator can go and grant it.
	const assigned = options.assignedByStaff === true;
	const status: VolunteerSignupStatus = assigned ? 'confirmed' : 'claimed';

	await requireActiveVolunteer(userId);

	const shift = await getShiftById(shiftId);
	if (!shift) throw new SignupNotFoundError();
	if (shift.cancelledAt) throw new ShiftClosedError('That shift was called off.');
	if (shift.endsAt && shift.endsAt < new Date())
		throw new ShiftClosedError('That shift has already happened.');

	// Clearance is checked against the shift's date, not today: a card that
	// lapses next week doesn't cover a shift the week after.
	//
	// An unscheduled work order has no date to check against, so the gate falls
	// back to today. That is a gate, not a record: `scheduleWorkOrder` runs this
	// again once a window exists, and the audit question -- was the card current
	// on the night they worked -- is answered at hour-log review against
	// `workedOn`, which is the only date that reflects reality.
	const missing = await missingRequirements(
		userId,
		shift.volunteerRoleId,
		shift.startsAt ?? new Date()
	);
	if (missing.length > 0) throw new NotClearedError(missing, assigned ? 'staff' : 'member');

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
			set "status" = ${status}, "claimed_at" = ${now},
				"confirmed_at" = ${assigned ? now : null},
				"cancelled_at" = null, "updated_at" = ${now}
			where "id" = ${existing.id} and ${hasRoomSql(shiftId, shift.capacity)}
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
		return revivedRow;
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
			where ${hasRoomSql(shiftId, shift.capacity)}
			returning "id"
		`);

		if (inserted.length === 0) throw new ShiftFullError();
		const row = await reloadSignup(id);
		void emitSignupEvent(assigned ? 'volunteer.signup_confirmed' : 'volunteer.signup_claimed', id);
		return row;
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

/**
 * Release a place on a shift, freeing it immediately.
 *
 * `owner` scopes the write to one member's own signup. The member path passes it, so a
 * signup id from somebody else's shift is a 404 rather than a cancellation; the staff path
 * (`releaseSignup`) does not, because a coordinator is acting on the roster and not on
 * their own claim.
 *
 * The status guard is shared: only a live claim can be released. Cancelling a `completed`
 * or `no_show` signup would rewrite a fact about a shift that has already happened, which
 * is what `markNoShow` is for.
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
 * Fire-and-forget on purpose, the same shape `submitHours` uses: the status is already
 * written, and a notification that fails must not roll back a claim or leave a confirmed
 * signup looking unconfirmed. The row is re-read rather than passed in because every
 * caller has a bare `volunteer_signup` and the listeners want the role name and the
 * member's name — which is one join here instead of three call sites doing it.
 */
async function emitSignupEvent(
	event: 'volunteer.signup_claimed' | 'volunteer.signup_confirmed' | 'volunteer.signup_cancelled',
	signupId: string
): Promise<void> {
	try {
		const [row] = await db
			.select({
				shiftId: volunteerShift.id,
				userId: user.id,
				userName: user.name,
				userEmail: user.email,
				roleName: volunteerRole.name,
				startsAt: volunteerShift.startsAt,
				endsAt: volunteerShift.endsAt
			})
			.from(volunteerSignup)
			.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
			.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
			.innerJoin(user, eq(user.id, volunteerSignup.userId))
			.where(eq(volunteerSignup.id, signupId))
			.limit(1);

		if (!row) return;

		await domainEvents.emit(event, {
			signupId,
			shiftId: row.shiftId,
			userId: row.userId,
			userName: row.userName,
			userEmail: row.userEmail,
			roleName: row.roleName,
			startsAt: row.startsAt?.toISOString() ?? null,
			endsAt: row.endsAt?.toISOString() ?? null
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
 * Deliberately the same write as a member dropping out, not a third status: the fact being
 * recorded is "this place is open again", and who typed it changes nothing about that. It
 * is emphatically NOT `markNoShow` — a coordinator hearing "I can't make Saturday" on
 * Thursday is being given notice, and recording that as a no-show would put a mark against
 * somebody who did the right thing.
 */
export async function releaseSignup(signupId: string): Promise<VolunteerSignup> {
	const row = await releaseSignupRow(signupId);
	void emitSignupEvent('volunteer.signup_cancelled', signupId);
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
		)
		// `ends_at < now` already excludes unscheduled work orders — the cron
		// cannot complete a row with no clock to run out. Restated so the types
		// follow the filter.
		.then((rows) => rows.filter(isScheduled));

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

	// Deliberately unfiltered by schedule: this is everyone on one named shift,
	// and an unscheduled work order has claimants like any other row.
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
		)
		.then((rows) => rows.filter(isScheduled));
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
		)
		.then((rows) => rows.filter(isScheduled));
}

export interface MemberSignup {
	signupId: string;
	shiftId: string;
	roleName: string;
	// Null for a work order the member has taken on but nobody has scheduled.
	// Deliberately not filtered out: this is their record of what they signed up
	// for, and dropping the undated rows would hide work they are committed to.
	startsAt: Date | null;
	endsAt: Date | null;
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
 * `volunteer_shift.event_id` is nullable by design (work parties, repair days), so a join
 * would have to be a left one, and this file otherwise knows nothing about the event
 * schema. One scalar select keeps it that way.
 */
const eventTitleSql = sql<string | null>`(
	select e."title" from "event" e where e."id" = ${volunteerShift.eventId}
)`;

/**
 * How far back the close-out list and the badge look for shifts that finished without
 * being confirmed. Past a week this is history, not work. Shared so the number on the nav
 * and the rows on the dashboard cover the same window.
 */
export const CLOSE_OUT_LOOKBACK_DAYS = 7;

export interface OutstandingClaim {
	signupId: string;
	userId: string;
	member: MemberRef;
	shiftId: string;
	volunteerRoleId: string;
	roleName: string;
	startsAt: Date;
	endsAt: Date;
	eventTitle: string | null;
	claimedAt: Date;
}

/**
 * Claims on shifts that have not happened yet and nobody has confirmed.
 *
 * The join is the whole point: a claim is only interesting alongside the shift it is on,
 * because "confirm this" and "this is on Saturday" are one decision. Ordered by the shift
 * rather than by when the claim arrived — the soonest shift is the one that runs out of
 * time first.
 *
 * Cancelled shifts are excluded. A claim on a shift that was called off is not waiting on
 * anybody; the shift page still shows it, which is where you go to see what was cancelled.
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
			volunteerRoleId: volunteerRole.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			eventTitle: eventTitleSql,
			claimedAt: volunteerSignup.claimedAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.status, 'claimed'),
				isNull(volunteerShift.cancelledAt),
				gte(volunteerShift.startsAt, now),
				before ? lt(volunteerShift.startsAt, before) : undefined
			)
		)
		.orderBy(asc(volunteerShift.startsAt), asc(volunteerSignup.claimedAt));

	return rows.filter(isScheduled).map((row) => ({ ...row, member: toMemberRef(row.member) }));
}

/**
 * Shifts that have finished with a claim nobody ever confirmed.
 *
 * These are the silent losses. `completeFinishedShifts` only promotes `confirmed`
 * signups, so an unconfirmed claim on a shift that has already happened never completes:
 * no hour log is offered, no feedback is asked for, and the person who very probably
 * turned up leaves no trace. Nothing in the app said so, and by the time anybody looked
 * the shift had dropped off the default list.
 *
 * The window is deliberately short. Past a week this is history, not work.
 */
export async function listUnclosedSignups(
	{ since }: { since: Date },
	now = new Date()
): Promise<OutstandingClaim[]> {
	const rows = await db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			member: memberRefColumns(),
			shiftId: volunteerShift.id,
			volunteerRoleId: volunteerRole.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			eventTitle: eventTitleSql,
			claimedAt: volunteerSignup.claimedAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.status, 'claimed'),
				isNull(volunteerShift.cancelledAt),
				lt(volunteerShift.endsAt, now),
				gte(volunteerShift.endsAt, since)
			)
		)
		.orderBy(desc(volunteerShift.startsAt));

	return rows.filter(isScheduled).map((row) => ({ ...row, member: toMemberRef(row.member) }));
}

/**
 * How many things are waiting on a coordinator, as one number.
 *
 * The sidebar badge and the dashboard's own summary both read this, so the count on the
 * nav and the rows on the page cannot disagree. It counts rather than lists: the badge
 * runs on every staff page load and has no use for the rows.
 *
 * The four buckets are the four cards the dashboard leads with. Lapsing clearances are
 * deliberately absent — those are waiting on a member to go and renew something, not on
 * staff, and a badge that never reaches zero stops being read.
 */
export async function countVolunteerWorkWaiting(now = new Date()): Promise<number> {
	const lookback = new Date(now.getTime() - CLOSE_OUT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

	const [pendingHours, claims, blocked, unclosed] = await Promise.all([
		db.select({ n: count() }).from(volunteerHourLog).where(eq(volunteerHourLog.status, 'pending')),
		db
			.select({ n: count() })
			.from(volunteerSignup)
			.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
			.where(
				and(
					eq(volunteerSignup.status, 'claimed'),
					isNull(volunteerShift.cancelledAt),
					gte(volunteerShift.startsAt, now)
				)
			),
		db.select({ n: count() }).from(volunteerProfile).where(eq(volunteerProfile.status, 'blocked')),
		db
			.select({ n: count() })
			.from(volunteerSignup)
			.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
			.where(
				and(
					eq(volunteerSignup.status, 'claimed'),
					isNull(volunteerShift.cancelledAt),
					lt(volunteerShift.endsAt, now),
					gte(volunteerShift.endsAt, lookback)
				)
			)
	]);

	return (
		Number(pendingHours[0]?.n ?? 0) +
		Number(claims[0]?.n ?? 0) +
		Number(blocked[0]?.n ?? 0) +
		Number(unclosed[0]?.n ?? 0)
	);
}
