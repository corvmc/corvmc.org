import { db } from '$lib/server/db';
import { volunteerHourLog, volunteerRole } from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, gte, lte, desc, count, sql, type SQL } from 'drizzle-orm';
import { paginate, type PaginationInput, type PaginatedResult } from '$lib/server/db/paginate';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

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
			minutes: sumMinutes,
			logCount: count()
		})
		.from(volunteerHourLog)
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(approvedIn(range))
		.groupBy(volunteerHourLog.volunteerRoleId, volunteerRole.name, volunteerRole.isActive)
		.orderBy(desc(sumMinutes));

	return rows.map((row) => ({
		volunteerRoleId: row.volunteerRoleId,
		roleName: row.roleName,
		roleIsActive: row.roleIsActive,
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
