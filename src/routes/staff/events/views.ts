import type { Capability } from '#lib/config.js';

/**
 * The Calendar (#2766, #3112) is one list whose view filter chooses which rows
 * it shows: every listing, the venues, or every market's vendor applications.
 * Listings are the unfiltered list. Productions is a list of its own.
 */
export const eventViews = ['listings', 'venues', 'vendors'] as const;
export type EventView = (typeof eventViews)[number];

/** The capability each view's remotes or actions guard on. */
export const eventViewCapability: Record<EventView, Capability> = {
	listings: 'event.read',
	venues: 'event.read',
	vendors: 'event.manage'
};

export function eventView(params: Pick<URLSearchParams, 'get'>): EventView {
	const view = params.get('view');
	return eventViews.find((v) => v !== 'listings' && v === view) ?? 'listings';
}

/** The query that picks a view on `/staff/events`, before the view's own filters. */
export function eventViewQuery(view: EventView): string {
	return view === 'listings' ? '' : `view=${view}`;
}

/** The list's address for a view, carrying an old URL's query along. */
export function eventViewPath(view: EventView, search = ''): string {
	const query = [eventViewQuery(view), search.replace(/^\?/, '')].filter(Boolean).join('&');
	return query ? `/staff/events?${query}` : '/staff/events';
}
