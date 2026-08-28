import { db } from '$lib/server/db';
import { bandSite } from '$lib/server/db/schema/band-site';
import { group } from '$lib/server/db/schema/group';
import { eq } from 'drizzle-orm';

/**
 * The `band_site` row a band owns — created with the band, and the row every
 * tier, subscription and custom-domain read and write goes through.
 *
 * Kept beside the band services rather than inside one of them because three of
 * them need it: creation, the Stripe subscription sync, and the custom-domain
 * flow.
 */

/** The insert a band's site row is created from, for the batch that creates the band. */
export function bandSiteInsert(groupId: string) {
	return db.insert(bandSite).values({ groupId });
}

/**
 * The site id for a band, creating one if it somehow has none.
 *
 * Every band that existed when phase 3b shipped got a row from
 * `scripts/db/backfill/band-site.sql`, and every new one gets it in the same
 * batch as the band, so the create branch should be dead. It is here because
 * the alternative when it is not dead is worse: an `UPDATE … WHERE id = null`
 * writes nothing and reports success, so a band would be told its subscription
 * had been recorded when it had not. A band created in the window between the
 * backfill running and this code deploying is the one real way to reach it.
 */
export async function getOrCreateBandSiteId(groupId: string): Promise<string> {
	const [existing] = await db
		.select({ id: bandSite.id })
		.from(bandSite)
		.where(eq(bandSite.groupId, groupId))
		.limit(1);
	if (existing) return existing.id;

	const [band] = await db
		.select({ id: group.id })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	if (!band) throw new Error(`No group ${groupId} to create a band site for`);

	const [created] = await db.insert(bandSite).values({ groupId }).returning({ id: bandSite.id });
	return created.id;
}
