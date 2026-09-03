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
 * numbers included. The public page publishes none of that.
 *
 * A deferred step slots in here without moving anything else — Cloudflare
 * Browser Rendering turning `renderPressKitHtml`'s string into a real
 * `press-kit.pdf` beside the HTML.
 */
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { zipSync, strToU8 } from 'fflate';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bandSite } from '$lib/server/db/schema/band-site';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { and } from 'drizzle-orm';
import { requireGroupRole } from '$lib/server/group/group-context';
import { listFor as listMediaFor } from '$lib/server/media/media-service';
import { getObject } from '$lib/server/storage';
import { getMembers } from '$lib/server/band/band-service';
import { listBandEventsUpcoming } from '$lib/server/event/event-service';
import { fullPressKit } from '$lib/server/band/press-kit';
import { renderPressKitHtml, renderPressKitText } from '$lib/server/band/press-kit-html';
import type { PressKitDocument } from '$lib/server/band/press-kit-html';
import { sanitizeBio } from '$lib/utils/markdown';
import { canonicalAddress } from '$lib/utils/canonical-address';
import { extensionForType } from '$lib/server/storage-keys';
import { env as publicEnv } from '$env/dynamic/public';
import type { ProfileLink } from '$lib/server/db/schema/authentication';

/**
 * Everything held in memory at once, so this is a real ceiling rather than a
 * guess. A Worker gets 128MB and each photo may be 10MB; refusing with a
 * message a band can act on beats an isolate killed mid-response, which they
 * would see as a download that silently produced nothing.
 */
const MAX_PACK_BYTES = 50 * 1024 * 1024;

function slugifyName(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'press-kit'
	);
}

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

	const files: Record<string, Uint8Array> = {};
	let packBytes = 0;

	/** Pull one object into the zip, or skip it if the bucket no longer has it. */
	async function pack(key: string, path: string, fallbackType: string): Promise<string | null> {
		const object = await getObject(key);
		// A `media` row whose object is gone is a missing file, not a failure —
		// the whole kit should still assemble.
		if (!object) return null;
		if (packBytes + object.bytes.byteLength > MAX_PACK_BYTES) return null;
		packBytes += object.bytes.byteLength;
		const ext = extensionForType(object.contentType ?? fallbackType);
		const named = `${path}.${ext}`;
		files[named] = object.bytes;
		return named;
	}

	const photoPaths: string[] = [];
	let i = 1;
	for (const item of media.filter((m) => m.slot === 'gallery')) {
		const path = await pack(item.key, `photos/press-${i}`, 'image/jpeg');
		if (path) {
			photoPaths.push(path);
			i++;
		}
	}

	if (packBytes >= MAX_PACK_BYTES) {
		throw error(413, 'Your press kit is too large to package. Remove a few photos and try again.');
	}

	const dateFormat = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	const doc: PressKitDocument = {
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
			when: dateFormat.format(e.startsAt),
			where: e.location ?? null
		})),
		links: ((entry?.links as ProfileLink[] | null) ?? []).map((l) => ({
			label: l.label,
			url: l.url
		})),
		epk: fullPressKit(site?.epk),
		photoPaths
	};

	files['press-kit.html'] = strToU8(renderPressKitHtml(doc));
	files['press-kit.txt'] = strToU8(renderPressKitText(doc));

	// `zipSync`, not the streaming builder: everything is already resident by
	// the time we get here, so streaming would add a pipeline without lowering
	// the peak. `level: 0` for the images — a JPEG does not deflate, and the
	// pass costs CPU for a percent or two.
	const zipped = zipSync(files, { level: 6, mtime: new Date() });
	const filename = `${slugifyName(band.name)}-press-kit.zip`;

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
