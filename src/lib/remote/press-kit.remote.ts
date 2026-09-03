/**
 * The press kit a band writes, and the one query the editor loads it with.
 *
 * Separate from `band-page-editor.remote.ts` because the two answer to
 * different gates now. The block editor is premium and lives behind
 * `requireFeature('bandPremium')`; the press kit is free, so it must keep
 * working with that flag off — which is its state in production.
 */
import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bandSite } from '$lib/server/db/schema/band-site';
import { requireGroupRole } from '$lib/server/group/group-context';
import { getOrCreateBandSiteId } from '$lib/server/band/band-site-service';
import { fullPressKit } from '$lib/server/band/press-kit';
import { listFor as listMediaFor, setDescription } from '$lib/server/media/media-service';
import { resolveImageUrl } from '$lib/server/storage';
import { jsonObjectField } from '$lib/utils/zod-json';
import { photoLimitForTier } from '$lib/server/band/press-kit-limits';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * The press-kit editor's one load-bearing query: the kit itself plus every
 * file it can point at.
 *
 * `fullPressKit` rather than the raw column — this page is the one surface
 * allowed to show the advance half, and going through the projection anyway
 * keeps the "nothing reads `epk` raw" rule true without an exception to
 * remember.
 */
export const getPressKitEditor = query(z.string(), async (slug) => {
	const { group: band } = await requireGroupRole({ slug }, 'admin');

	const [[site], media] = await Promise.all([
		db
			.select({ epk: bandSite.epk, tier: bandSite.tier })
			.from(bandSite)
			.where(eq(bandSite.groupId, band.id))
			.limit(1),
		// One statement for all three slots. `avatar` is deliberately absent: the
		// band's logo is edited on the profile page and served from
		// `group.avatarKey`, not from here.
		listMediaFor('group', band.id, ['gallery', 'stage_plot', 'rider'])
	]);

	const tier = site?.tier ?? 'free';

	return {
		epk: fullPressKit(site?.epk),
		tier,
		/** How many more photos this band may add, so the UI can say so before an upload 403s. */
		photoLimit: photoLimitForTier(tier),
		media: media.map((m) => ({
			id: m.attachmentId,
			url: resolveImageUrl(m.key),
			slot: m.slot,
			filename: m.filename,
			altText: m.altText,
			caption: m.caption
		}))
	};
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const saveBandEpk = form(
	z.object({
		slug: z.string().min(1),
		// JSON-encoded BandEpk. Decoded in the schema so malformed input is a field
		// issue on `epk` rather than a whole-page 400.
		epk: jsonObjectField('Invalid press kit data')
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ slug: data.slug }, 'admin');

		// Deliberately no tier check and no `requireFeature('bandPremium')`. A
		// press kit is what a band *is*, not what it buys — `band_site` holds
		// both, and `epk` is the free half of that row. What premium adds is
		// presentation and volume (video, an unbounded gallery, a themed page on
		// their own domain), never the information a venue needs to book them.
		//
		// `getOrCreateBandSiteId` rather than a bare `UPDATE … WHERE group_id`:
		// against a band whose row is somehow missing, the update matches nothing,
		// writes nothing, and still returns success — the band would be told its
		// press kit was saved when it was not.
		const siteId = await getOrCreateBandSiteId(band.id);

		await db
			.update(bandSite)
			.set({ epk: data.epk, updatedAt: new Date() })
			.where(eq(bandSite.id, siteId));

		void getPressKitEditor(data.slug).refresh();

		return { success: true };
	}
);

/**
 * Alt text and captions belong to the `media` row, not to the press kit JSON,
 * so they save separately from the form above — a photo's description is a
 * property of the object, and the same object may be attached twice.
 */
export const savePhotoDetails = form(
	z.object({
		slug: z.string().min(1),
		attachmentId: z.string().min(1),
		altText: z.string().max(300).optional().default(''),
		caption: z.string().max(300).optional().default('')
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ slug: data.slug }, 'admin');

		const [row] = await listMediaFor('group', band.id, ['gallery', 'stage_plot', 'rider']).then(
			(all) => all.filter((m) => m.attachmentId === data.attachmentId)
		);
		// Scoped through the band's own list, so an attachment id belonging to
		// another group cannot be relabelled by passing it here.
		if (!row) throw error(404, 'Photo not found');

		await setDescription(row.mediaId, {
			altText: data.altText || null,
			caption: data.caption || null
		});

		void getPressKitEditor(data.slug).refresh();

		return { success: true };
	}
);
