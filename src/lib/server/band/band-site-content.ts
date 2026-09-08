import { db } from '$lib/server/db';
import { groupMember } from '$lib/server/db/schema/group';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { user } from '$lib/server/db/schema/authentication';
import { listFor as listMediaFor } from '$lib/server/media/media-service';
import { resolveImageUrl } from '$lib/server/storage';
import {
	listBandEventsUpcoming,
	listBandEventsPast,
	type EventRow
} from '$lib/server/event/event-service';
import { eq, and } from 'drizzle-orm';
import type { Block } from '$lib/server/db/schema/band-page';

/**
 * Everything `BandSiteRenderer` needs beyond the block config.
 *
 * Extracted because the page editor renders the same component as the public
 * microsite. Before the editor became the preview it passed empty arrays and a
 * stub band, which was fine when the preview only had to show colour and type —
 * and became wrong the moment blocks started reporting whether they are empty,
 * since a band with ten shows would have been told it had none.
 */

/** The four slots the microsite renders. */
const SITE_MEDIA_SLOTS = ['gallery', 'hero', 'stage_plot', 'rider'] as const;

/** Shape an event row for the microsite. */
function toSiteEvent(e: EventRow) {
	return {
		id: e.id,
		title: e.title,
		description: e.description,
		startsAt: e.startsAt,
		endsAt: e.endsAt,
		location: e.location,
		externalTicketUrl: e.externalTicketUrl,
		ticketPrice: e.ticketPrice,
		posterUrl: resolveImageUrl(e.posterKey)
	};
}

export interface BandRowForSite {
	id: string;
	name: string;
	slug: string;
	avatarKey: string | null;
}

/**
 * Load the roster, gig list, genres, media and directory entry for a band's
 * site. Takes the band row so each caller keeps its own guard: the public page
 * 404s a free band, the editor requires a member.
 */
export async function loadBandSiteContent(
	bandRow: BandRowForSite,
	entry?: typeof directoryEntry.$inferSelect | null
) {
	const resolvedEntry =
		entry !== undefined
			? entry
			: ((
					await db
						.select()
						.from(directoryEntry)
						.where(eq(directoryEntry.groupId, bandRow.id))
						.limit(1)
				)[0] ?? null);

	const members = await db
		.select({
			id: groupMember.id,
			userName: user.name,
			alias: groupMember.alias,
			userImage: user.image,
			position: groupMember.position,
			role: groupMember.role
		})
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(and(eq(groupMember.groupId, bandRow.id), eq(groupMember.status, 'active')));

	const genres = await db
		.select({ value: directoryTag.value })
		.from(directoryTag)
		.innerJoin(directoryEntry, eq(directoryEntry.id, directoryTag.entryId))
		.where(and(eq(directoryEntry.groupId, bandRow.id), eq(directoryTag.kind, 'genre')));

	// Upcoming, plus enough history for a "past shows" section
	const [events, pastEvents] = await Promise.all([
		listBandEventsUpcoming(bandRow.id, 10),
		listBandEventsPast(bandRow.id, { limit: 20, offset: 0 })
	]);

	// Named explicitly rather than taking everything attached to the group,
	// because the group's `avatar` is now a `media_attachment` too and is served
	// from `band.avatarUrl`, not from here.
	const media = await listMediaFor('group', bandRow.id, [...SITE_MEDIA_SLOTS]);

	return {
		entry: resolvedEntry,
		band: {
			id: bandRow.id,
			name: bandRow.name,
			slug: bandRow.slug,
			bio: resolvedEntry?.bio ?? null,
			tagline: resolvedEntry?.tagline ?? null,
			avatarUrl: resolveImageUrl(bandRow.avatarKey),
			links: resolvedEntry?.links as Array<{
				label: string;
				url: string;
				embed?: boolean;
			}> | null,
			genres: genres.map((g) => g.value)
		},
		members: members.map((m) => ({
			id: m.id,
			// The band's own site credits people the way the band credits them.
			name: m.alias ?? m.userName,
			image: resolveImageUrl(m.userImage),
			position: m.position,
			role: m.role
		})),
		events: events.map(toSiteEvent),
		// listBandEventsPast fetches limit+1 to derive hasMore; the microsite just
		// shows a fixed slice.
		pastEvents: pastEvents.slice(0, 20).map(toSiteEvent),
		media: media.map((m) => ({
			id: m.attachmentId,
			url: resolveImageUrl(m.key),
			slot: m.slot,
			caption: m.caption
		}))
	};
}

/**
 * Every R2 key the blocks point at, resolved to a public URL.
 *
 * The editor keeps its blocks *raw* — they are what gets saved, and writing a
 * resolved URL back into `imageKey` would corrupt the row — so image resolution
 * cannot happen on the way in the way it does for the public page. This map
 * lets the client resolve at render time and leave the saved value alone.
 */
export function blockImageUrls(blocks: Block[]): Record<string, string> {
	const keys = new Set<string>();
	for (const block of blocks) {
		if (block.type === 'hero' && block.imageKey) keys.add(block.imageKey);
		if (block.type === 'gallery') for (const k of block.imageKeys) if (k) keys.add(k);
		if (block.type === 'merch')
			for (const item of block.items) if (item.imageKey) keys.add(item.imageKey);
	}

	const urls: Record<string, string> = {};
	for (const key of keys) {
		const url = resolveImageUrl(key);
		if (url) urls[key] = url;
	}
	return urls;
}
