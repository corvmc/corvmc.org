import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { bandSite } from '$lib/server/db/schema/band-site';
import { and, count, eq, gte, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';

/** Every row of the staff band list; clubs and committees share the table. */
export const isBand = (): SQL => eq(group.kind, 'band');

/** The Bands table's default "Active" status filter. */
export const activeBand = (): SQL => isNull(group.deletedAt);

/** The "Deactivated" status filter. */
export const deactivatedBand = (): SQL => isNotNull(group.deletedAt);

/** The "Premium" tier filter. Needs `bandSite` joined; a band with no site row is free. */
export const premiumBand = (): SQL => eq(bandSite.tier, 'premium');

export const NEW_BAND_DAYS = 30;

export interface BandTotals {
	/** Active bands — what the list shows by default. */
	active: number;
	/** Active bands on the premium tier. */
	premium: number;
	/** Active bands created in the last `NEW_BAND_DAYS` days. */
	newBands: number;
}

const countWhere = (predicate: SQL | undefined) => count(sql`case when ${predicate} then 1 end`);

/** Org-wide band totals in one scan; deliberately blind to the table's filters. */
export async function getBandTotals(now = new Date()): Promise<BandTotals> {
	const since = new Date(now.getTime() - NEW_BAND_DAYS * 24 * 60 * 60 * 1000);
	const [row] = await db
		.select({
			active: countWhere(activeBand()),
			premium: countWhere(and(activeBand(), premiumBand())),
			newBands: countWhere(and(activeBand(), gte(group.createdAt, since)))
		})
		.from(group)
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(isBand());
	return row ?? { active: 0, premium: 0, newBands: 0 };
}
