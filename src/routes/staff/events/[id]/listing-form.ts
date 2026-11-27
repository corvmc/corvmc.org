import { addIsoDays } from '#lib/utils/deadline.js';
import { clubInstant } from '#lib/utils/format.js';

/**
 * What the Listing form decides before it posts. Pure, so each rule is pinned
 * without rendering: `updateEvent` takes every field, and what is left unposted
 * is as meaningful as what is sent.
 */

export type Where = 'room' | 'venue' | 'other';
export type Tickets = 'none' | 'link' | 'cmc' | 'band';

/**
 * Where the show is, read off what is stored. "Somewhere else" has no column:
 * a blank venue means our room (`holdsSpace(null)`), so it is a blank venue
 * with no hold and a typed place.
 */
export function initialWhere(
	event: { venueId: string | null; location: string | null; address: string | null },
	hasHold: boolean,
	venues: { id: string; isPrimary: boolean }[]
): Where {
	const venue = venues.find((v) => v.id === event.venueId);
	if (event.venueId && !venue?.isPrimary) return 'venue';
	if (hasHold) return 'room';
	if (event.location?.trim() || event.address?.trim()) return 'other';
	return 'room';
}

/**
 * How tickets are sold, read off what is stored. A price counts as a link:
 * saving 'none' clears it, so a listing that states a price must not load as
 * having none.
 */
export function initialTickets(event: {
	source: string;
	ticketingEnabled: boolean;
	externalTicketUrl: string | null;
	ticketPrice: number | null;
	ticketPriceFloorCents: number | null;
}): Tickets {
	if (event.ticketingEnabled) return event.source === 'cmc' ? 'cmc' : 'band';
	if (event.externalTicketUrl || event.ticketPrice || event.ticketPriceFloorCents) return 'link';
	return 'none';
}

/** Dollars as typed, as the cents string `updateEvent` reads; blank stays blank. */
export function centsOf(dollars: string): string {
	if (dollars.trim() === '') return '';
	const parsed = Number.parseFloat(dollars);
	return Number.isFinite(parsed) ? String(Math.round(parsed * 100)) : '';
}

export interface WhereState {
	/** The venue picked under "Saved venue". */
	venueId: string;
	hasHold: boolean;
	cancelled: boolean;
	/** A new hold is asked for, or a rebook is confirmed. */
	holdWanted: boolean;
	holdStart: string;
	holdEnd: string;
}

export interface WherePosts {
	venueId: string;
	/** `location` and `address` post only for "Somewhere else". */
	postsPlace: boolean;
	releaseHold: boolean;
	rebookReservation: boolean;
}

/**
 * Practice space posts a blank venue; a saved venue posts its id; somewhere
 * else posts a blank venue and the typed place. `updateEvent` refuses a hold
 * away from the room, so leaving it releases the one the show has.
 */
export function wherePosts(choice: Where, s: WhereState): WherePosts {
	const holds = !s.cancelled;
	if (choice === 'room') {
		return {
			venueId: '',
			postsPlace: false,
			releaseHold: false,
			rebookReservation: holds && s.holdWanted && !!s.holdStart && !!s.holdEnd
		};
	}
	return {
		venueId: choice === 'venue' ? s.venueId : '',
		postsPlace: choice === 'other',
		releaseHold: holds && s.hasHold,
		rebookReservation: false
	};
}

export interface TicketValues {
	externalTicketUrl: string;
	/** Dollars, as typed. */
	price: string;
	floor: string;
	quantity: string;
}

export interface TicketPosts {
	/** Absent for a listing CMC does not sell: `false` would close a band's own sale (#1556). */
	ticketingEnabled?: boolean;
	externalTicketUrl?: string;
	ticketPrice?: string;
	ticketPriceFloorCents?: string;
	ticketQuantity?: string;
}

/** A field left out of the result is a field left alone on the server. */
export function ticketPosts(choice: Tickets, source: string, v: TicketValues): TicketPosts {
	const sellsHere = source === 'cmc';
	const flag = sellsHere ? { ticketingEnabled: choice === 'cmc' } : {};
	if (choice === 'band') return {};
	if (choice === 'none') {
		return { ...flag, externalTicketUrl: '', ticketPrice: '', ticketPriceFloorCents: '' };
	}
	if (choice === 'link') {
		return { ...flag, externalTicketUrl: v.externalTicketUrl, ticketPrice: centsOf(v.price) };
	}
	if (!sellsHere) return {};
	return {
		ticketingEnabled: true,
		externalTicketUrl: '',
		ticketPrice: centsOf(v.price),
		ticketPriceFloorCents: centsOf(v.floor),
		ticketQuantity: v.quantity
	};
}

export const toMinutes = (t: string) => {
	const [h, m] = t.split(':').map(Number);
	return h * 60 + m;
};

export const shiftTime = (time: string, minutes: number) => {
	const total = (((toMinutes(time) + minutes) % 1440) + 1440) % 1440;
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** The rebook check compares instants, so the wall clock is read in club time. */
export function isoRange(date: string, startTime: string, endTime: string) {
	const startsAt = clubInstant(date, startTime);
	// A show that ends past midnight ends the next day, as the server builds it.
	const endsOnNextDay = clubInstant(date, endTime) < startsAt;
	const endsAt = clubInstant(endsOnNextDay ? addIsoDays(date, 1) : date, endTime);
	return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}
