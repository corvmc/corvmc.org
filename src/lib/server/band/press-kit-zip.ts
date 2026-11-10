/**
 * The press kit packed as a zip, for the two audiences that download it.
 *
 * `packPressKit` is shared. What goes into the document is not: the band's own
 * download carries the full kit, and `loadPublicPressKit` builds one from what
 * the public `/epk` page renders and nothing else.
 */
import { error } from '@sveltejs/kit';
import { zipSync, strToU8 } from 'fflate';
import { and, eq, isNull } from 'drizzle-orm';
import * as publicEnv from '$app/env/public';
import { db } from '#lib/server/db/index.js';
import { group } from '#lib/server/db/schema/group.js';
import { directoryEntry } from '#lib/server/db/schema/directory.js';
import { bandSite } from '#lib/server/db/schema/band-site.js';
import { listFor as listMediaFor } from '#lib/server/media/media-service.js';
import { getObject } from '#lib/server/storage.js';
import { extensionForType } from '#lib/server/storage-keys.js';
import { loadBandSiteContent } from '#lib/server/band/band-site-content.js';
import { publicPressKit } from '#lib/server/band/press-kit.js';
import { renderPressKitHtml, renderPressKitText } from '#lib/server/band/press-kit-html.js';
import type { PressKitDocument } from '#lib/server/band/press-kit-html.js';
import type { BandEpk } from '#lib/types/band-page.js';
import { sanitizeBio } from '#lib/utils/markdown.js';
import { canonicalAddress } from '#lib/utils/canonical-address.js';

/**
 * Everything is held in memory at once: a Worker gets 128MB and each photo may
 * be 10MB. A refusal the band can act on beats an isolate killed mid-response.
 */
const MAX_PACK_BYTES = 50 * 1024 * 1024;

/** The public page lists this many upcoming shows; the public kit lists no more. */
const PUBLIC_SHOW_LIMIT = 5;

export type PressKitContent = Omit<PressKitDocument, 'photoPaths'>;

export function pressKitFilename(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${slug || 'press'}-press-kit.zip`;
}

const showDate = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	year: 'numeric'
});

export function formatShowDate(date: Date): string {
	return showDate.format(date);
}

/**
 * The one-pager, its plain-text twin and the photos at full resolution, zipped.
 * A photo whose object is gone from the bucket is skipped, not a failure.
 */
export async function packPressKit(
	content: PressKitContent,
	photoKeys: string[]
): Promise<Uint8Array> {
	const files: Record<string, Uint8Array> = {};
	const photoPaths: string[] = [];
	let packBytes = 0;

	for (const key of photoKeys) {
		const object = await getObject(key);
		if (!object) continue;
		if (packBytes + object.bytes.byteLength > MAX_PACK_BYTES) {
			packBytes = MAX_PACK_BYTES;
			break;
		}
		packBytes += object.bytes.byteLength;
		const path = `photos/press-${photoPaths.length + 1}.${extensionForType(object.contentType ?? 'image/jpeg')}`;
		files[path] = object.bytes;
		photoPaths.push(path);
	}

	if (packBytes >= MAX_PACK_BYTES) {
		throw error(413, 'This press kit is too large to package. Remove a few photos and try again.');
	}

	const doc: PressKitDocument = { ...content, photoPaths };
	files['press-kit.html'] = strToU8(renderPressKitHtml(doc));
	files['press-kit.txt'] = strToU8(renderPressKitText(doc));

	return zipSync(files, { level: 6, mtime: new Date() });
}

type SiteContent = Awaited<ReturnType<typeof loadBandSiteContent>>;

/**
 * The public kit, field for field what `/band-site/[slug]/epk` renders.
 *
 * `publicPressKit` drops every contact. Videos, hometown and founded year are
 * not on that page either, so they stay out. Members are credited by the
 * band's alias, as the page credits them, never by the account name.
 */
export function publicPressKitContent(
	content: Pick<SiteContent, 'band' | 'members' | 'events'>,
	epk: BandEpk | null | undefined
): PressKitContent {
	const { band } = content;
	return {
		name: band.name,
		tagline: band.tagline,
		bioHtml: band.bio ? sanitizeBio(band.bio) : null,
		genres: band.genres,
		hometown: null,
		foundedYear: null,
		url: canonicalAddress(
			{ kind: 'group', slug: band.slug },
			{ siteUrl: publicEnv.PUBLIC_SITE_URL }
		),
		members: content.members.map((m) => ({ name: m.name, position: m.position ?? null })),
		shows: content.events.slice(0, PUBLIC_SHOW_LIMIT).map((e) => ({
			title: e.title,
			when: formatShowDate(e.startsAt),
			where: e.location ?? null
		})),
		links: (band.links ?? []).map((l) => ({ label: l.label, url: l.url })),
		epk: { ...publicPressKit(epk), videos: [] }
	};
}

/**
 * The public kit for `slug`, or `null` when its press kit is not public.
 *
 * Public means what makes `getBandSiteData` serve the `/epk` page: the band
 * exists, is not deleted, and its site is premium. This checks that itself,
 * because an endpoint is reachable whether or not a page links to it.
 */
export async function loadPublicPressKit(
	slug: string
): Promise<{ name: string; content: PressKitContent; photoKeys: string[] } | null> {
	const [joined] = await db
		.select({ band: group, entry: directoryEntry, site: bandSite })
		.from(group)
		.leftJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(and(eq(group.slug, slug), isNull(group.deletedAt)))
		.limit(1);

	if (!joined?.band || joined.site?.tier !== 'premium') return null;

	const [siteContent, gallery] = await Promise.all([
		loadBandSiteContent(joined.band, joined.entry ?? null),
		listMediaFor('group', joined.band.id, 'gallery')
	]);

	return {
		name: joined.band.name,
		content: publicPressKitContent(siteContent, joined.site.epk),
		photoKeys: gallery.map((m) => m.key)
	};
}
