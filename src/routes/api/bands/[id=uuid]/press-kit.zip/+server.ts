/**
 * The press kit as a file a band can attach to an email.
 *
 * The zip holds a self-contained one-pager, a plain-text version for pasting
 * into a message body, and the photos at full resolution. Nothing in it is
 * fetched over the network when it is opened.
 *
 * No rider and no stage plot: an EPK is what a booker reads when deciding
 * whether to offer a date, and the technical half is a different document sent
 * at a different moment. It lives at `/band/[slug]/rider` and exports itself.
 *
 * Admin-only, and deliberately so: this is the *full* kit, contacts and phone
 * numbers included. The public download at `/band-site/[slug]/epk/press-kit.zip`
 * carries none of that.
 *
 * A deferred step slots in here without moving anything else — Cloudflare
 * Browser Rendering turning `renderPressKitHtml`'s string into a real
 * `press-kit.pdf` beside the HTML.
 */
import type { RequestHandler } from './$types';
import { eq, and } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { bandSite } from '#lib/server/db/schema/band-site.js';
import { directoryEntry, directoryTag } from '#lib/server/db/schema/directory.js';
import { requireGroupRole } from '#lib/server/group/group-context.js';
import { listFor as listMediaFor } from '#lib/server/media/media-service.js';
import { getMembers } from '#lib/server/band/band-service.js';
import { listBandEventsUpcoming } from '#lib/server/event/event-service.js';
import { fullPressKit } from '#lib/server/band/press-kit.js';
import {
	formatShowDate,
	packPressKit,
	pressKitFilename,
	type PressKitContent
} from '#lib/server/band/press-kit-zip.js';
import { sanitizeBio } from '#lib/utils/markdown.js';
import { canonicalAddress } from '#lib/utils/canonical-address.js';
import * as publicEnv from '$app/env/public';
import type { ProfileLink } from '#lib/server/db/schema/authentication.js';

export const GET: RequestHandler = async ({ params }) => {
	const bandId = params.id;
	const { group: band } = await requireGroupRole({ id: bandId }, 'admin');

	const [[entry], [site], genres, members, shows, media] = await Promise.all([
		db
			.select({
				bio: directoryEntry.bio,
				tagline: directoryEntry.tagline,
				hometown: directoryEntry.hometown,
				foundedYear: directoryEntry.foundedYear,
				links: directoryEntry.links
			})
			.from(directoryEntry)
			.where(eq(directoryEntry.groupId, band.id))
			.limit(1),
		db.select({ epk: bandSite.epk }).from(bandSite).where(eq(bandSite.groupId, band.id)).limit(1),
		db
			.select({ value: directoryTag.value })
			.from(directoryTag)
			.innerJoin(directoryEntry, eq(directoryEntry.id, directoryTag.entryId))
			.where(and(eq(directoryEntry.groupId, band.id), eq(directoryTag.kind, 'genre'))),
		getMembers(band.id),
		listBandEventsUpcoming(band.id, 10),
		// `gallery` only. The stage plot and rider belong to the tech rider at
		// `/band/[slug]/rider`, which has its own export — an EPK is a booking
		// document, and a booker weighing a date has no use for a channel list.
		listMediaFor('group', band.id, 'gallery')
	]);

	const content: PressKitContent = {
		name: band.name,
		tagline: entry?.tagline ?? null,
		bioHtml: entry?.bio ? sanitizeBio(entry.bio) : null,
		genres: genres.map((g) => g.value),
		hometown: entry?.hometown ?? null,
		foundedYear: entry?.foundedYear ?? null,
		url: canonicalAddress(
			{ kind: 'group', slug: band.slug },
			{ siteUrl: publicEnv.PUBLIC_SITE_URL }
		),
		members: members
			.filter((m) => m.status === 'active')
			.map((m) => ({ name: m.member.title, position: m.position ?? null })),
		shows: shows.map((e) => ({
			title: e.title,
			when: formatShowDate(e.startsAt),
			where: e.location ?? null
		})),
		links: ((entry?.links as ProfileLink[] | null) ?? []).map((l) => ({
			label: l.label,
			url: l.url
		})),
		epk: fullPressKit(site?.epk)
	};

	const zipped = await packPressKit(
		content,
		media.filter((m) => m.slot === 'gallery').map((m) => m.key)
	);
	const filename = pressKitFilename(band.name);

	return new Response(zipped, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${filename}"`,
			'content-length': String(zipped.byteLength),
			// The kit changes whenever the act edits it, and it is behind an admin
			// guard besides.
			'cache-control': 'private, no-store'
		}
	});
};
