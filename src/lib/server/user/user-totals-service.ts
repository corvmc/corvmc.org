import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { and, count, gte, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';

/** The Users table's "Active" status filter. Every ban also sets `deletedAt`. */
export const activeUser = (): SQL => isNull(user.deletedAt);

/** The Users table's "Deactivated" status filter. */
export const deactivatedUser = (): SQL => isNotNull(user.deletedAt);

export const NEW_MEMBER_DAYS = 7;

export interface UserTotals {
	/** Active accounts only — deactivated and banned are not counted. */
	accounts: number;
	/** Active accounts with a subscription snapshot, the sustaining-member source of truth. */
	sustaining: number;
	/** Active accounts created in the last `NEW_MEMBER_DAYS` days. */
	newMembers: number;
}

const countWhere = (predicate: SQL | undefined) => count(sql`case when ${predicate} then 1 end`);

/** Org-wide account totals in one scan; deliberately blind to the Users table's filters. */
export async function getUserTotals(now = new Date()): Promise<UserTotals> {
	const since = new Date(now.getTime() - NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000);
	const [row] = await db
		.select({
			accounts: countWhere(activeUser()),
			sustaining: countWhere(and(activeUser(), isNotNull(user.subscription))),
			newMembers: countWhere(and(activeUser(), gte(user.createdAt, since)))
		})
		.from(user);
	return row ?? { accounts: 0, sustaining: 0, newMembers: 0 };
}
