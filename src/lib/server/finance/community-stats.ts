import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, isNull, isNotNull, count, sql } from 'drizzle-orm';
import { getJson, putJson, deleteKey } from '#lib/server/kv.js';
import { creditsToHours } from '#lib/config.js';

export interface CommunityStats {
	sustainingMemberCount: number;
	totalFreeHoursAllocated: number;
	participationPercent: number;
}

const STATS_KEY = 'community-stats';
const TTL_SECONDS = 86400; // 24 hours

export async function getCommunityStats(): Promise<CommunityStats> {
	const cached = await getJson<CommunityStats>(STATS_KEY);
	if (cached) return cached;

	const stats = await queryStats();
	await putJson(STATS_KEY, stats, TTL_SECONDS);
	return stats;
}

/** Drop the cached stats and recompute now (staff-triggered). */
export async function refreshCommunityStats(): Promise<CommunityStats> {
	await deleteKey(STATS_KEY);
	return getCommunityStats();
}

async function queryStats(): Promise<CommunityStats> {
	// Source from the subscription snapshot (the app-wide source of truth) rather
	// than the credit ledger — migrated members hold balances but have no
	// monthly_allocation ledger rows, which would make every stat read 0.
	const [subStats] = await db
		.select({
			memberCount: count(),
			totalCredits: sql<number>`COALESCE(SUM(CAST(json_extract(${user.subscription}, '$.hoursPerReset') AS INTEGER)), 0)`
		})
		.from(user)
		.where(and(isNotNull(user.subscription), isNull(user.deletedAt)));

	const sustainingMemberCount = subStats?.memberCount ?? 0;
	// hoursPerReset is in credits (30-min blocks); report funded practice time in hours.
	const totalFreeHoursAllocated = creditsToHours(Number(subStats?.totalCredits ?? 0));

	const [userStats] = await db.select({ total: count() }).from(user).where(isNull(user.deletedAt));
	const totalUsers = userStats?.total ?? 0;

	const participationPercent =
		totalUsers > 0 ? Math.round((sustainingMemberCount / totalUsers) * 100 * 10) / 10 : 0;

	return {
		sustainingMemberCount,
		totalFreeHoursAllocated,
		participationPercent
	};
}
