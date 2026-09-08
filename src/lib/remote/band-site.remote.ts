import { z } from 'zod';
import { error, redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { query } from '$app/server';
import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { bandSite } from '$lib/server/db/schema/band-site';
import { eq, and, isNull } from 'drizzle-orm';
import { loadBandSiteContent } from '$lib/server/band/band-site-content';
import { prepareBlocksForRender } from '$lib/server/band/band-site-blocks';
import { resolveBandSlug } from '$lib/server/band/band-address-service';
import { bandSiteUrl } from '$lib/utils/band-site-url';
import { reconcileBlocks } from '$lib/utils/band-site-preset';
import type { Block } from '$lib/server/db/schema/band-page';

// ---------------------------------------------------------------------------
// Band Site Data — loads everything needed to render a premium band page
// ---------------------------------------------------------------------------

export const getBandSiteData = query(z.string(), async (slug) => {
	// LEFT join, unlike the directory's. There, no entry means no listing and a
	// 404 is the right answer; here the page is granted by `tier`, and a premium
	// band whose entry went missing should lose its bio, not its site.
	const [joined] = await db
		.select({ band: group, entry: directoryEntry, site: bandSite })
		.from(group)
		.leftJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(and(eq(group.slug, slug), isNull(group.deletedAt)))
		.limit(1);

	const bandRow = joined?.band;
	const entry = joined?.entry;
	const site = joined?.site;

	if (!bandRow) {
		// Not just for stale bookmarks: `/api/host-route` answers with
		// `max-age=300`, which purging the KV host cache cannot clear, so for a few
		// minutes after an address change a band's own custom domain keeps
		// rerouting here with the old slug. Without this, those are hard 404s on
		// the domain they paid for.
		const moved = await resolveBandSlug(slug);
		if (moved?.kind === 'moved' && moved.slug !== slug) {
			redirect(302, bandSiteUrl(moved.slug, publicEnv.PUBLIC_SITE_URL));
		}
		throw error(404, 'Band not found');
	}
	if (site?.tier !== 'premium') throw error(404, 'Page not found');

	// The page config IS the site row since phase 3c — already fetched above.
	const config = site;

	// The roster, gig list, genres and media — shared with the page editor, which
	// renders the same component.
	const content = await loadBandSiteContent(bandRow, entry ?? null);

	return {
		band: {
			...content.band,
			// Only a live custom domain counts — canonical URLs must not point at a
			// hostname that isn't serving yet.
			customDomain: site?.customDomainStatus === 'active' ? site.customDomain : null
		},
		config: config
			? {
					theme: config.theme,
					customCss: config.customCss,
					// Reconciled first, so a premium band that has never opened the
					// editor still publishes the preset layout rather than the fallback.
					blocks: prepareBlocksForRender(reconcileBlocks(config.blocks as Block[])),
					epk: config.epk
				}
			: null,
		members: content.members,
		events: content.events,
		pastEvents: content.pastEvents,
		media: content.media
	};
});
