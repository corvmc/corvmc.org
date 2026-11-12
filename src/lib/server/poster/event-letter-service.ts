import { DomainError } from '#lib/server/domain-error.js';
import { getObject } from '#lib/server/storage.js';
import { listFor } from '#lib/server/media/media-service.js';
import { creditsForEvent } from '#lib/server/sponsor/credit-service.js';
import { bytesDataUrl } from './brand';
import { flyerLines } from './flyer';
import { FLYER_ALT_PREFIX, flyerSource } from './flyer-service';
import { eventUrl, renderEventLetter, type EventLetter } from './event-letter';
import { withPosterPage } from './browser';
import { sponsorLogos } from './sponsor-logos';

/** The event has no uploaded image to print. A generated flyer does not count. */
export class EventPosterArtMissingError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('Upload the event’s image first');
	}
}

/**
 * The print poster's content: the event's uploaded poster image, its details,
 * its public page and the sponsors its page credits. A generated flyer in the
 * slot is refused, since it already carries the details the footer adds.
 */
export async function eventLetter(eventId: string): Promise<EventLetter> {
	const source = await flyerSource(eventId);
	const [poster] = await listFor('event_listing', eventId, 'poster');
	if (!poster || poster.altText?.startsWith(FLYER_ALT_PREFIX)) {
		throw new EventPosterArtMissingError();
	}
	const object = await getObject(poster.key);
	if (!object) throw new EventPosterArtMissingError();
	return {
		lines: flyerLines(source),
		address: source.address,
		url: eventUrl(eventId),
		art: bytesDataUrl(object.bytes, object.contentType ?? poster.contentType),
		sponsors: await sponsorLogos(await creditsForEvent(eventId, 'eventPage'))
	};
}

/** The event's Letter print poster as a PDF. A snapshot: nothing stores it. */
export async function renderEventPoster(
	eventId: string
): Promise<{ pdf: Uint8Array; title: string }> {
	const poster = await eventLetter(eventId);
	const pdf = await withPosterPage((page) => renderEventLetter(page, poster));
	return { pdf, title: poster.lines.title };
}
