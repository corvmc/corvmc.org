import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { count, sql } from 'drizzle-orm';

export interface UserTotals {
	total: number;
	active: number;
	/** Active accounts with a subscription snapshot, the sustaining-member source of truth. */
	sustaining: number;
	/** Every ban also sets `deletedAt`, so bans are counted here. */
	deactivated: number;
}

/** Org-wide account totals in one scan; deliberately blind to the Users table's filters. */
export async function getUserTotals(): Promise<UserTotals> {
	const [row] = await db
		.select({
			total: count(),
			active: count(sql`case when ${user.deletedAt} is null then 1 end`),
			sustaining: count(
				sql`case when ${user.deletedAt} is null and ${user.subscription} is not null then 1 end`
			),
			deactivated: count(user.deletedAt)
		})
		.from(user);
	return row ?? { total: 0, active: 0, sustaining: 0, deactivated: 0 };
}
