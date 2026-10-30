import { resolveImageUrl } from '$lib/server/storage';
import type { CalendarEntry } from '$lib/types/calendar';
import type { EventRow } from './event-service';

/**
 * Shape an event row for the gig-list components. Band attribution is optional
 * because rows scoped to a single band (a band's own profile) never join it —
 * the caller already knows whose shows these are.
 */
export function toCalendarEntry(
	e: EventRow & { bandName?: string | null; bandSlug?: string | null; venueName?: string | null }
): CalendarEntry {
	return {
		id: e.id,
		title: e.title,
		startsAt: e.startsAt,
		endsAt: e.endsAt,
		source: e.source,
		status: e.status,
		location: e.location,
		venueName: e.venueName ?? null,
		bandName: e.bandName ?? null,
		bandSlug: e.bandSlug ?? null,
		posterUrl: resolveImageUrl(e.posterKey),
		ticketingEnabled: e.ticketingEnabled,
		ticketPrice: e.ticketPrice,
		externalTicketUrl: e.externalTicketUrl
	};
}
