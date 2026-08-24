import { db } from '$lib/server/db';
import { volunteerHourLog, volunteerRole } from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, or, like, gte, lte, desc, count, sql, type SQL } from 'drizzle-orm';
import { paginate, type PaginationInput, type PaginatedResult } from '$lib/server/db/paginate';
import { memberRefColumns, toMemberRef, type MemberRefRow } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { buildDateInTz, formatDateInTz } from '$lib/server/reservation/timezone';
import { domainEvents } from '$lib/server/events/event-bus';
import { captureException } from '$lib/server/sentry';
import { DomainError } from '$lib/server/errors';
import {
	DEFAULT_TIMEZONE,
	VOLUNTEER_BACKDATE_LIMIT_DAYS,
	VOLUNTEER_DESCRIPTION_MAX,
	VOLUNTEER_MAX_MINUTES_PER_LOG,
	VOLUNTEER_REVIEW_NOTES_MAX,
	volunteerHourStatusLabels
} from '$lib/config';
import { getActiveVolunteerRoleById } from './volunteer-role-service';
import { VolunteerRoleNotFoundError } from './volunteer-role-service';
import { requireActiveVolunteer } from './volunteer-profile-service';
import type { VolunteerHourLog, VolunteerHourStatus } from '$lib/server/db/schema/volunteer';

const TZ = DEFAULT_TIMEZONE;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HourLogNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Hour log not found');
	}
}

export class HourLogAlreadyReviewedError extends DomainError {
	readonly httpStatus = 409;
	constructor(status: string) {
		// The stored `rejected` reads as "returned" everywhere anyone sees it. The
		// non-enum `'reviewed'` this is also thrown with falls through unchanged.
		const label =
			status in volunteerHourStatusLabels
				? volunteerHourStatusLabels[status as VolunteerHourStatus].toLowerCase()
				: status;
		super(`This log was already ${label}. Ask the member to submit a corrected one.`);
	}
}

export class HourLogNotEditableError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('Only your own pending hour logs can be changed');
	}
}

export class HourLogValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface SubmitHoursData {
	volunteerRoleId: string;
	/** YYYY-MM-DD in club time. */
	workedOn: string;
	minutes: number;
	description: string;
	/** The completed shift this log pre-filled from, when it did. */
	shiftId?: string | null;
}

/**
 * A calendar date anchored at NOON club time, so the report's UTC-based
 * `strftime('%Y-%m', ...)` always agrees with the local date. Midnight local
 * would also work for the Americas, but not for a UTC-ahead zone, where it is
 * the previous UTC day. See the note on `volunteerHourLog.workedOn`.
 */
function toWorkedOn(dateStr: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
		throw new HourLogValidationError('Date must be a calendar date');
	}

	const workedOn = buildDateInTz(dateStr, '12:00', TZ);
	if (Number.isNaN(workedOn.getTime())) {
		throw new HourLogValidationError('Date must be a calendar date');
	}

	// Compare calendar dates in club time, NOT the anchored instant against now.
	// workedOn is pinned to noon, so comparing instants rejected today's date all
	// morning: at 10am club time, noon today is still two hours away and every
	// same-day submission came back as "a future date".
	const now = new Date();
	const today = formatDateInTz(now, TZ);
	if (dateStr > today) {
		throw new HourLogValidationError('You cannot log hours for a future date');
	}

	const earliest = formatDateInTz(
		new Date(now.getTime() - VOLUNTEER_BACKDATE_LIMIT_DAYS * 24 * 60 * 60 * 1000),
		TZ
	);
	if (dateStr < earliest) {
		throw new HourLogValidationError(
			`Hours must be logged within ${VOLUNTEER_BACKDATE_LIMIT_DAYS} days. ` +
				`Ask staff to add anything older.`
		);
	}

	return workedOn;
}

function validateMinutes(minutes: number): number {
	if (!Number.isInteger(minutes) || minutes < 1) {
		throw new HourLogValidationError('Enter how long you worked');
	}
	if (minutes > VOLUNTEER_MAX_MINUTES_PER_LOG) {
		throw new HourLogValidationError(
			`A single log cannot exceed ${VOLUNTEER_MAX_MINUTES_PER_LOG / 60} hours. ` +
				`Split a longer stretch across days.`
		);
	}
	return minutes;
}

function validateDescription(description: string): string {
	const trimmed = description.trim();
	if (!trimmed) throw new HourLogValidationError('Describe what you worked on');
	if (trimmed.length > VOLUNTEER_DESCRIPTION_MAX) {
		throw new HourLogValidationError(
			`Description must be ${VOLUNTEER_DESCRIPTION_MAX} characters or fewer`
		);
	}
	return trimmed;
}

function validateReviewNotes(notes: string | undefined, required: boolean): string | null {
	const trimmed = notes?.trim() ?? '';
	if (required && !trimmed) {
		throw new HourLogValidationError('Give the member a reason so they can correct it');
	}
	if (trimmed.length > VOLUNTEER_REVIEW_NOTES_MAX) {
		throw new HourLogValidationError(
			`Note must be ${VOLUNTEER_REVIEW_NOTES_MAX} characters or fewer`
		);
	}
	return trimmed || null;
}

/**
 * Submission may only target a live role. Review deliberately does NOT check
 * this — archiving a role while logs sit in the queue must not strand them.
 */
async function requireActiveRole(volunteerRoleId: string) {
	const role = await getActiveVolunteerRoleById(volunteerRoleId);
	if (!role) throw new VolunteerRoleNotFoundError();
	return role;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function submitHours(
	userId: string,
	data: SubmitHoursData
): Promise<VolunteerHourLog> {
	// Checked in the service, not just on the route: the remote function is a
	// directly callable endpoint and the route gate is only a redirect.
	await requireActiveVolunteer(userId);

	const role = await requireActiveRole(data.volunteerRoleId);
	const workedOn = toWorkedOn(data.workedOn);
	const minutes = validateMinutes(data.minutes);
	const description = validateDescription(data.description);

	const [log] = await db
		.insert(volunteerHourLog)
		.values({
			userId,
			volunteerRoleId: role.id,
			shiftId: data.shiftId ?? null,
			workedOn,
			minutes,
			description,
			status: 'pending'
		})
		.returning();

	const [member] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('volunteer.hours_submitted', {
				logId: log.id,
				userId,
				userName: member?.name ?? 'Unknown',
				userEmail: member?.email ?? '',
				roleName: role.name,
				hours: minutes / 60,
				workedOn: workedOn.toISOString(),
				description
			});
		} catch (err) {
			captureException(err, { event: 'volunteer.hours_submitted', logId: log.id });
		}
	});

	return log;
}

export async function updateHourLog(
	logId: string,
	userId: string,
	data: Partial<SubmitHoursData>
): Promise<VolunteerHourLog> {
	await requireActiveVolunteer(userId);

	const existing = await requireOwnPendingLog(logId, userId);

	const values: Partial<typeof volunteerHourLog.$inferInsert> = { updatedAt: new Date() };

	if (data.volunteerRoleId !== undefined) {
		values.volunteerRoleId = (await requireActiveRole(data.volunteerRoleId)).id;
	}
	if (data.workedOn !== undefined) values.workedOn = toWorkedOn(data.workedOn);
	if (data.minutes !== undefined) values.minutes = validateMinutes(data.minutes);
	if (data.description !== undefined) values.description = validateDescription(data.description);

	const [row] = await db
		.update(volunteerHourLog)
		.set(values)
		.where(and(eq(volunteerHourLog.id, existing.id), eq(volunteerHourLog.status, 'pending')))
		.returning();

	if (!row) throw new HourLogNotEditableError();
	return row;
}

/**
 * Withdrawal is a hard delete, not a fourth status. Nothing downstream
 * references an hour log, so there is no audit trail to preserve, and a
 * `withdrawn` status would be a value no report ever selects.
 */
export async function withdrawHourLog(logId: string, userId: string): Promise<void> {
	await requireOwnPendingLog(logId, userId);

	const [row] = await db
		.delete(volunteerHourLog)
		.where(
			and(
				eq(volunteerHourLog.id, logId),
				eq(volunteerHourLog.userId, userId),
				eq(volunteerHourLog.status, 'pending')
			)
		)
		.returning();

	if (!row) throw new HourLogNotEditableError();
}

export async function approveHourLog(
	logId: string,
	staffId: string,
	notes?: string
): Promise<VolunteerHourLog> {
	return review(logId, staffId, 'approved', validateReviewNotes(notes, false));
}

export async function rejectHourLog(
	logId: string,
	staffId: string,
	notes: string
): Promise<VolunteerHourLog> {
	return review(logId, staffId, 'rejected', validateReviewNotes(notes, true));
}

/**
 * Approving grants nothing. No credit_transaction is written here, deliberately
 * — volunteer hours are a record, not a currency. `hour-log-service.spec.ts`
 * asserts it.
 */
async function review(
	logId: string,
	staffId: string,
	status: Extract<VolunteerHourStatus, 'approved' | 'rejected'>,
	reviewNotes: string | null
): Promise<VolunteerHourLog> {
	const existing = await getRawLog(logId);
	if (!existing) throw new HourLogNotFoundError();
	if (existing.status !== 'pending') throw new HourLogAlreadyReviewedError(existing.status);

	const reviewedAt = new Date();

	// Re-assert 'pending' in the WHERE so two staff clicking at once can't both
	// win — the loser gets the already-reviewed error rather than overwriting.
	const [row] = await db
		.update(volunteerHourLog)
		.set({ status, reviewedByUserId: staffId, reviewedAt, reviewNotes, updatedAt: reviewedAt })
		.where(and(eq(volunteerHourLog.id, logId), eq(volunteerHourLog.status, 'pending')))
		.returning();

	if (!row) throw new HourLogAlreadyReviewedError('reviewed');

	// Archived roles still resolve here — the work happened either way.
	const [context] = await db
		.select({
			userName: user.name,
			userEmail: user.email,
			roleName: volunteerRole.name
		})
		.from(volunteerHourLog)
		.innerJoin(user, eq(volunteerHourLog.userId, user.id))
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(eq(volunteerHourLog.id, logId))
		.limit(1);

	const [reviewer] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, staffId))
		.limit(1);

	const event = status === 'approved' ? 'volunteer.hours_approved' : 'volunteer.hours_rejected';

	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit(event, {
				logId: row.id,
				userId: row.userId,
				userName: context?.userName ?? 'Unknown',
				userEmail: context?.userEmail ?? '',
				roleName: context?.roleName ?? 'Volunteering',
				hours: row.minutes / 60,
				workedOn: row.workedOn.toISOString(),
				reviewNotes,
				reviewedByName: reviewer?.name ?? 'Staff'
			});
		} catch (err) {
			captureException(err, { event, logId: row.id });
		}
	});

	return row;
}

async function getRawLog(logId: string) {
	const [row] = await db
		.select()
		.from(volunteerHourLog)
		.where(eq(volunteerHourLog.id, logId))
		.limit(1);
	return row ?? null;
}

async function requireOwnPendingLog(logId: string, userId: string) {
	const existing = await getRawLog(logId);
	if (!existing) throw new HourLogNotFoundError();
	if (existing.userId !== userId || existing.status !== 'pending') {
		throw new HourLogNotEditableError();
	}
	return existing;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface HourLogFilters {
	status?: VolunteerHourStatus;
	userId?: string;
	volunteerRoleId?: string;
	/** YYYY-MM-DD, club time. */
	from?: string;
	to?: string;
	/** Member name or email. */
	search?: string;
}

export interface HourLogRow {
	id: string;
	userId: string;
	/** Who logged the hours. The `user` join is already here for the search. */
	member: MemberRef;
	volunteerRoleId: string;
	roleName: string;
	roleIsActive: boolean;
	workedOn: Date;
	minutes: number;
	description: string;
	/** Set when the log pre-filled from a completed shift — staff scheduled it. */
	shiftId: string | null;
	status: VolunteerHourStatus;
	reviewedByName: string | null;
	reviewedAt: Date | null;
	reviewNotes: string | null;
	createdAt: Date;
}

function escapeLike(input: string): string {
	return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

function buildFilters(filters: HourLogFilters): SQL[] {
	const conditions: SQL[] = [];

	if (filters.status) conditions.push(eq(volunteerHourLog.status, filters.status));
	if (filters.userId) conditions.push(eq(volunteerHourLog.userId, filters.userId));
	if (filters.volunteerRoleId) {
		conditions.push(eq(volunteerHourLog.volunteerRoleId, filters.volunteerRoleId));
	}
	if (filters.from) {
		conditions.push(gte(volunteerHourLog.workedOn, buildDateInTz(filters.from, '00:00', TZ)));
	}
	if (filters.to) {
		conditions.push(lte(volunteerHourLog.workedOn, buildDateInTz(filters.to, '23:59', TZ)));
	}
	if (filters.search) {
		const escaped = escapeLike(filters.search);
		conditions.push(or(like(user.name, `%${escaped}%`), like(user.email, `%${escaped}%`))!);
	}

	return conditions;
}

// A function, not a module-level const: `memberRefColumns()` builds correlated
// subqueries, and evaluating them at import time makes merely importing this
// module do work — which broke every spec that partially mocks `authorization`.
function hourLogSelect() {
	return {
		log: volunteerHourLog,
		member: memberRefColumns(),
		roleName: volunteerRole.name,
		roleIsActive: volunteerRole.isActive,
		// Correlated subquery rather than a second join on `user`, which would
		// need an alias and complicate the count query that shares this WHERE.
		reviewedByName: sql<
			string | null
		>`(select name from "user" where "user".id = ${volunteerHourLog.reviewedByUserId})`
	};
}

type HourLogSelectRow = {
	log: VolunteerHourLog;
	member: MemberRefRow;
	roleName: string;
	roleIsActive: boolean;
	reviewedByName: string | null;
};

function toHourLogRow(row: HourLogSelectRow): HourLogRow {
	return {
		id: row.log.id,
		userId: row.log.userId,
		member: toMemberRef(row.member),
		volunteerRoleId: row.log.volunteerRoleId,
		roleName: row.roleName,
		roleIsActive: row.roleIsActive,
		workedOn: row.log.workedOn,
		minutes: row.log.minutes,
		description: row.log.description,
		shiftId: row.log.shiftId,
		status: row.log.status,
		reviewedByName: row.reviewedByName,
		reviewedAt: row.log.reviewedAt,
		reviewNotes: row.log.reviewNotes,
		createdAt: row.log.createdAt
	};
}

export async function listHourLogs(
	filters: HourLogFilters = {},
	pagination: PaginationInput = {}
): Promise<PaginatedResult<HourLogRow>> {
	const conditions = buildFilters(filters);
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const dataQ = db
		.select(hourLogSelect())
		.from(volunteerHourLog)
		.innerJoin(user, eq(volunteerHourLog.userId, user.id))
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(where)
		.orderBy(desc(volunteerHourLog.workedOn), desc(volunteerHourLog.createdAt))
		.$dynamic();

	const countQ = db
		.select({ count: count() })
		.from(volunteerHourLog)
		.innerJoin(user, eq(volunteerHourLog.userId, user.id))
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(where);

	const result = await paginate(dataQ, countQ, pagination);

	return { ...result, rows: result.rows.map(toHourLogRow) };
}

export async function getHourLog(id: string): Promise<HourLogRow | null> {
	const [row] = await db
		.select(hourLogSelect())
		.from(volunteerHourLog)
		.innerJoin(user, eq(volunteerHourLog.userId, user.id))
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(eq(volunteerHourLog.id, id))
		.limit(1);

	return row ? toHourLogRow(row) : null;
}

export async function listUserHourLogs(userId: string): Promise<HourLogRow[]> {
	const { rows } = await listHourLogs({ userId }, { page: 1, pageSize: 200 });
	return rows;
}

export async function getStatusCounts(): Promise<Record<VolunteerHourStatus | 'all', number>> {
	const rows = await db
		.select({ status: volunteerHourLog.status, count: count() })
		.from(volunteerHourLog)
		.groupBy(volunteerHourLog.status);

	const counts = { pending: 0, approved: 0, rejected: 0, all: 0 };
	for (const row of rows) {
		counts[row.status] = row.count;
		counts.all += row.count;
	}
	return counts;
}

export interface UserHourSummary {
	approvedMinutes: number;
	pendingMinutes: number;
	approvedMinutesThisYear: number;
	logCount: number;
}

export async function getUserHourSummary(userId: string): Promise<UserHourSummary> {
	// Unix seconds, not the Date. This boundary goes into a raw `sql` fragment,
	// where drizzle binds whatever it is handed — there is no column in scope for
	// it to read `mode: 'timestamp'` off, so a Date reaches the driver as an
	// object and D1 rejects the statement with D1_TYPE_ERROR, taking the whole
	// member volunteering page with it. The column stores seconds; match it.
	const yearStart = Math.floor(
		buildDateInTz(`${new Date().getFullYear()}-01-01`, '00:00', TZ).getTime() / 1000
	);

	const [row] = await db
		.select({
			approvedMinutes: sql<number>`coalesce(sum(case when ${volunteerHourLog.status} = 'approved' then ${volunteerHourLog.minutes} else 0 end), 0)`,
			pendingMinutes: sql<number>`coalesce(sum(case when ${volunteerHourLog.status} = 'pending' then ${volunteerHourLog.minutes} else 0 end), 0)`,
			approvedMinutesThisYear: sql<number>`coalesce(sum(case when ${volunteerHourLog.status} = 'approved' and ${volunteerHourLog.workedOn} >= ${yearStart} then ${volunteerHourLog.minutes} else 0 end), 0)`,
			logCount: count()
		})
		.from(volunteerHourLog)
		.where(eq(volunteerHourLog.userId, userId));

	return {
		approvedMinutes: Number(row?.approvedMinutes ?? 0),
		pendingMinutes: Number(row?.pendingMinutes ?? 0),
		approvedMinutesThisYear: Number(row?.approvedMinutesThisYear ?? 0),
		logCount: Number(row?.logCount ?? 0)
	};
}
