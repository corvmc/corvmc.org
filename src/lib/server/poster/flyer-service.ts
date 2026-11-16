import { db } from '#lib/server/db/index.js';
import { eventBand, eventListing } from '#lib/server/db/schema/event.js';
import { venue } from '#lib/server/db/schema/venue.js';
import { ticketSaleColumns } from '#lib/server/event/event-columns.js';
import { asc, eq } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import { getObject, uploadFile } from '#lib/server/storage.js';
import { mediaKey } from '#lib/server/storage-keys.js';
import { replaceSlot } from '#lib/server/media/media-service.js';
import {
	deliveredPosterArt,
	PosterRequestNotFoundError
} from '#lib/server/production/artifact-request-service.js';
import { creditsForEvent } from '#lib/server/sponsor/credit-service.js';
import { flyerLines, renderFlyer, type FlyerSource } from './flyer';
import { sponsorLogos } from './sponsor-logos';

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

// How a generated flyer is told from uploaded art in the poster slot.
export const FLYER_ALT_PREFIX = 'Flyer for ';

/** The flyer's facts, and the street address the print poster adds. */
export async function flyerSource(
	eventId: string
): Promise<FlyerSource & { address: string | null; shortCode: string | null }> {
	const [row] = await db
		.select({
			title: eventListing.title,
			shortCode: eventListing.shortCode,
			startsAt: eventListing.startsAt,
			doorsAt: eventListing.doorsAt,
			venueName: venue.name,
			location: eventListing.location,
			address: eventListing.address,
			venueAddress: venue.address1,
			venueCity: venue.city,
			venueState: venue.state,
			// The sale terms live on `ticket_sale` (#1203).
			ticketingEnabled: ticketSaleColumns.ticketingEnabled,
			ticketPrice: ticketSaleColumns.ticketPrice,
			ticketPriceFloorCents: ticketSaleColumns.ticketPriceFloorCents,
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

	const { venueAddress, venueCity, venueState, ...rest } = row;
	const town = [venueCity, venueState].filter(Boolean).join(', ');
	const venueLine = [venueAddress, town].filter(Boolean).join(', ');
	return {
		...rest,
		venue: row.venueName ?? row.location,
		address: row.address ?? (venueLine || null),
		bill: bill.map((b) => b.name)
	};
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
		altText: `${FLYER_ALT_PREFIX}${title}`
	});
}

/** The sponsors the event page credits, as the flyer draws them. */
async function flyerSponsors(eventId: string) {
	return sponsorLogos(await creditsForEvent(eventId, 'eventPage'));
}

/** The template flyer, from the event's own details, as its poster. */
export async function useTemplateFlyer(eventId: string): Promise<void> {
	const source = await flyerSource(eventId);
	const sponsors = await flyerSponsors(eventId);
	await publishFlyer(eventId, source.title, await renderFlyer(flyerLines(source), { sponsors }));
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
		art: { bytes: object.bytes, contentType: object.contentType ?? 'image/png' },
		sponsors: await flyerSponsors(eventId)
	});
	await publishFlyer(eventId, source.title, png);
	return { eventId };
}
