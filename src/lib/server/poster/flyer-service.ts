import { db } from '$lib/server/db';
import { eventBand, eventListing } from '$lib/server/db/schema/event';
import { venue } from '$lib/server/db/schema/venue';
import { asc, eq } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { getObject, uploadFile } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';
import { replaceSlot } from '$lib/server/media/media-service';
import {
	deliveredPosterArt,
	PosterRequestNotFoundError
} from '$lib/server/production/artifact-request-service';
import { flyerLines, renderFlyer, type FlyerSource } from './flyer';

/**
 * Rendering a flyer and making it the event's poster. A flyer is a snapshot:
 * editing the event does not re-render it, running the action again does. The
 * #850 readiness gate reads the same slot, so a template flyer satisfies it.
 */

export class FlyerEventNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Event not found');
	}
}

async function flyerSource(eventId: string): Promise<FlyerSource> {
	const [row] = await db
		.select({
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			doorsAt: eventListing.doorsAt,
			venueName: venue.name,
			location: eventListing.location,
			ticketingEnabled: eventListing.ticketingEnabled,
			ticketPrice: eventListing.ticketPrice,
			ticketPriceFloorCents: eventListing.ticketPriceFloorCents,
			externalTicketUrl: eventListing.externalTicketUrl
		})
		.from(eventListing)
		.leftJoin(venue, eq(venue.id, eventListing.venueId))
		.where(eq(eventListing.id, eventId))
		.limit(1);
	if (!row) throw new FlyerEventNotFoundError();

	const bill = await db
		.select({ name: eventBand.name })
		.from(eventBand)
		.where(eq(eventBand.eventId, eventId))
		.orderBy(asc(eventBand.billingOrder));

	return { ...row, venue: row.venueName ?? row.location, bill: bill.map((b) => b.name) };
}

async function publishFlyer(eventId: string, title: string, png: Uint8Array): Promise<void> {
	const key = mediaKey('events/posters', eventId, 'image/png');
	const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
	await uploadFile(buffer, key, 'image/png');
	await replaceSlot({
		attachableType: 'event_listing',
		attachableId: eventId,
		slot: 'poster',
		key,
		contentType: 'image/png',
		byteSize: png.byteLength,
		altText: `Flyer for ${title}`
	});
}

/** The template flyer, from the event's own details, as its poster. */
export async function useTemplateFlyer(eventId: string): Promise<void> {
	const source = await flyerSource(eventId);
	await publishFlyer(eventId, source.title, await renderFlyer(flyerLines(source)));
}

/**
 * Delivered art above a details footer, as the poster. Always from the
 * artist's original, so running it twice cannot stack footers.
 */
export async function useArtWithFooter(requestId: string): Promise<{ eventId: string }> {
	const { eventId, key } = await deliveredPosterArt(requestId);
	const object = await getObject(key);
	if (!object) throw new PosterRequestNotFoundError();

	const source = await flyerSource(eventId);
	const png = await renderFlyer(flyerLines(source), {
		bytes: object.bytes,
		contentType: object.contentType ?? 'image/png'
	});
	await publishFlyer(eventId, source.title, png);
	return { eventId };
}
