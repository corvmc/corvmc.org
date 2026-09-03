import { db } from '$lib/server/db';
import { volunteerHourLog, volunteerRole } from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, gte, lte, desc, count, sql, type SQL } from 'drizzle-orm';
import { paginate, type PaginationInput, type PaginatedResult } from '$lib/server/db/paginate';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { toContributedValue, type ContributedValue } from './hour-value';

const TZ = DEFAULT_TIMEZONE;

export interface ReportRange {
	/** YYYY-MM-DD, club time. */
	from?: string;
	to?: string;
}

/**
 * Every rollup here filters to approved hours only. That is the entire purpose
 * of the review step: a member can claim anything, and this report has to be
 * defensible to a funder.
 */
function approvedIn(range: ReportRange): SQL {
	const conditions: SQL[] = [eq(volunteerHourLog.status, 'approved')];

	if (range.from) {
		conditions.push(gte(volunteerHourLog.workedOn, buildDateInTz(range.from, '00:00', TZ)));
	}
	if (range.to) {
		conditions.push(lte(volunteerHourLog.workedOn, buildDateInTz(range.to, '23:59', TZ)));
	}

	return and(...conditions)!;
}

const sumMinutes = sql<number>`coalesce(sum(${volunteerHourLog.minutes}), 0)`;

// Minutes worked under a role marked as a specialized skill -- the narrower
// half of the two valuations.
const sumSpecializedMinutes = sql<number>`coalesce(sum(case when ${volunteerRole.isSpecializedSkill} then ${volunteerHourLog.minutes} else 0 end), 0)`;

// Specialized minutes on a role nobody has priced. They contribute zero rather
// than falling back to the site rate, and are reported separately so a funder
// facing number can say it is incomplete instead of quietly understating.
const sumUnpricedSpecializedMinutes = sql<number>`coalesce(sum(case when ${volunteerRole.isSpecializedSkill} and ${volunteerRole.marketRateCents} is null then ${volunteerHourLog.minutes} else 0 end), 0)`;

// Minute-cents: sum(minutes x that role's hourly rate), divided by 60 in
// TypeScript rather than here. SQLite integer division truncates, and each
// specialized role carries its own rate so there is no single multiplier to
// apply afterwards -- the weighting has to happen inside the sum.
const sumSpecializedMinuteCents = sql<number>`coalesce(sum(case when ${volunteerRole.isSpecializedSkill} and ${volunteerRole.marketRateCents} is not null then ${volunteerHourLog.minutes} * ${volunteerRole.marketRateCents} else 0 end), 0)`;

export interface VolunteerTotals {
	totalMinutes: number;
	volunteerCount: number;
	logCount: number;
}

export async function getVolunteerTotals(range: ReportRange = {}): Promise<VolunteerTotals> {
	const [row] = await db
		.select({
			totalMinutes: sumMinutes,
			volunteerCount: sql<number>`count(distinct ${volunteerHourLog.userId})`,
			logCount: count()
		})
		.from(volunteerHourLog)
		.where(approvedIn(range));

	return {
		totalMinutes: Number(row?.totalMinutes ?? 0),
		volunteerCount: Number(row?.volunteerCount ?? 0),
		logCount: Number(row?.logCount ?? 0)
	};
}

/**
 * What donated time in this range was worth, both ways.
 *
 * The join is safe: `volunteer_hour_log.volunteer_role_id` is NOT NULL with
 * `onDelete: 'restrict'`, so every log has a role and an inner join drops
 * nothing. Archived roles stay in for the same reason `getHoursByRole` keeps
 * them -- retiring a role does not un-happen the work done under it.
 */
export async function getContributedValue(range: ReportRange = {}): Promise<ContributedValue> {
	const [row] = await db
		.select({
			totalMinutes: sumMinutes,
			specializedMinutes: sumSpecializedMinutes,
			unpricedSpecializedMinutes: sumUnpricedSpecializedMinutes,
			specializedMinuteCents: sumSpecializedMinuteCents
		})
		.from(volunteerHourLog)
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(approvedIn(range));

	return toContributedValue({
		totalMinutes: Number(row?.totalMinutes ?? 0),
		specializedMinutes: Number(row?.specializedMinutes ?? 0),
		unpricedSpecializedMinutes: Number(row?.unpricedSpecializedMinutes ?? 0),
		// The one division, rounded once at the end rather than per role.
		specializedValueCents: Math.round(Number(row?.specializedMinuteCents ?? 0) / 60)
	});
}

export interface MemberHours {
	userId: string;
	member: MemberRef;
	minutes: number;
	logCount: number;
	lastWorkedOn: Date;
}

export async function getHoursByMember(
	range: ReportRange = {},
	pagination: PaginationInput = {}
): Promise<PaginatedResult<MemberHours>> {
	const where = approvedIn(range);

	const dataQ = db
		.select({
			userId: volunteerHourLog.userId,
			member: memberRefColumns(),
			minutes: sumMinutes,
			logCount: count(),
			lastWorkedOn: sql<number>`max(${volunteerHourLog.workedOn})`
		})
		.from(volunteerHourLog)
		.innerJoin(user, eq(volunteerHourLog.userId, user.id))
		.where(where)
		.groupBy(volunteerHourLog.userId, user.name, user.email)
		.orderBy(desc(sumMinutes))
		.$dynamic();

	// Distinct users, not rows. A plain count() under GROUP BY counts log rows
	// and would inflate totalPages.
	const countQ = db
		.select({ count: sql<number>`count(distinct ${volunteerHourLog.userId})` })
		.from(volunteerHourLog)
		.where(where);

	const result = await paginate(dataQ, countQ, pagination);

	return {
		...result,
		rows: result.rows.map((row) => ({
			userId: row.userId,
			member: toMemberRef(row.member),
			minutes: Number(row.minutes),
			logCount: Number(row.logCount),
			// max() over a timestamp column comes back as the raw unix seconds.
			lastWorkedOn: new Date(Number(row.lastWorkedOn) * 1000)
		}))
	};
}

export interface RoleHours {
	volunteerRoleId: string;
	roleName: string;
	roleIsActive: boolean;
	minutes: number;
	logCount: number;
	/** Whether these hours are recognizable contributed services at all. */
	isSpecializedSkill: boolean;
	/**
	 * The role's own hourly rate. Null on a specialized role is the gap a
	 * report has to show: those hours are worth something and nobody has said
	 * what, so they count as zero rather than as the impact rate.
	 */
	marketRateCents: number | null;
}

/**
 * Includes archived roles — retiring a role does not un-happen the work done
 * under it, and a report that silently dropped those hours would understate the
 * total.
 */
export async function getHoursByRole(range: ReportRange = {}): Promise<RoleHours[]> {
	const rows = await db
		.select({
			volunteerRoleId: volunteerHourLog.volunteerRoleId,
			roleName: volunteerRole.name,
			roleIsActive: volunteerRole.isActive,
			isSpecializedSkill: volunteerRole.isSpecializedSkill,
			marketRateCents: volunteerRole.marketRateCents,
			minutes: sumMinutes,
			logCount: count()
		})
		.from(volunteerHourLog)
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(approvedIn(range))
		.groupBy(
			volunteerHourLog.volunteerRoleId,
			volunteerRole.name,
			volunteerRole.isActive,
			volunteerRole.isSpecializedSkill,
			volunteerRole.marketRateCents
		)
		.orderBy(desc(sumMinutes));

	return rows.map((row) => ({
		volunteerRoleId: row.volunteerRoleId,
		roleName: row.roleName,
		roleIsActive: row.roleIsActive,
		isSpecializedSkill: row.isSpecializedSkill,
		marketRateCents: row.marketRateCents === null ? null : Number(row.marketRateCents),
		minutes: Number(row.minutes),
		logCount: Number(row.logCount)
	}));
}

export interface MonthHours {
	/** YYYY-MM */
	month: string;
	minutes: number;
	logCount: number;
}

export async function getHoursByMonth(range: ReportRange = {}): Promise<MonthHours[]> {
	// Buckets in UTC. Safe because workedOn is anchored at noon club time, which
	// lands mid-day UTC at any offset — see the note on volunteerHourLog.workedOn.
	const month = sql<string>`strftime('%Y-%m', ${volunteerHourLog.workedOn}, 'unixepoch')`;

	const rows = await db
		.select({ month, minutes: sumMinutes, logCount: count() })
		.from(volunteerHourLog)
		.where(approvedIn(range))
		.groupBy(month)
		.orderBy(month);

	return rows.map((row) => ({
		month: row.month,
		minutes: Number(row.minutes),
		logCount: Number(row.logCount)
	}));
}
