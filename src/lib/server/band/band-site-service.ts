import { db } from '#lib/server/db/index.js';
import { bandSite } from '#lib/server/db/schema/band-site.js';
import { group } from '#lib/server/db/schema/group.js';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { listFor as listMediaFor, descriptionUpdate } from '#lib/server/media/media-service.js';

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
	const existing = await findBandSiteId(groupId);
	if (existing) return existing;

	const [band] = await db
		.select({ id: group.id })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	if (!band) throw new Error(`No group ${groupId} to create a band site for`);

	// `idx_band_site_group`: two callers that both found none insert once.
	await db.insert(bandSite).values({ groupId }).onConflictDoNothing();
	const id = await findBandSiteId(groupId);
	if (!id) throw new Error(`No band site for group ${groupId}`);
	return id;
}

async function findBandSiteId(groupId: string): Promise<string | undefined> {
	const [row] = await db
		.select({ id: bandSite.id })
		.from(bandSite)
		.where(eq(bandSite.groupId, groupId))
		.limit(1);
	return row?.id;
}

export interface PressPhotoDetails {
	attachmentId: string;
	altText: string;
	caption: string;
}

/**
 * The press kit and its photos' descriptions, in one batch, so the page's one
 * Save writes both or neither. Photo ids are matched against the band's own
 * gallery, so an attachment belonging to another parent is skipped.
 */
export async function savePressKit(
	groupId: string,
	epk: Record<string, unknown>,
	photos: PressPhotoDetails[]
): Promise<void> {
	const siteId = await getOrCreateBandSiteId(groupId);
	const gallery = photos.length > 0 ? await listMediaFor('group', groupId, 'gallery') : [];
	const mediaIds = new Map(gallery.map((m) => [m.attachmentId, m.mediaId]));

	const writes: BatchItem<'sqlite'>[] = [
		db.update(bandSite).set({ epk, updatedAt: new Date() }).where(eq(bandSite.id, siteId))
	];
	for (const photo of photos) {
		const mediaId = mediaIds.get(photo.attachmentId);
		if (!mediaId) continue;
		writes.push(
			descriptionUpdate(mediaId, {
				altText: photo.altText.trim() || null,
				caption: photo.caption.trim() || null
			})
		);
	}
	await db.batch(writes as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}
