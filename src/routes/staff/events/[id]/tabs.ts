import type { ResolvedPathname } from '$app/types';
import { withQuery } from '#lib/utils/with-query.js';

/**
 * The staff event page's tabs (#3270). A CMC show has Listing, Production and
 * History; a market adds Vendors; every other event has Listing and History.
 * The page opens on Listing, which takes no `tab` in the URL.
 */
export const EVENT_TABS = ['listing', 'production', 'vendors', 'history'] as const;

export type EventTab = (typeof EVENT_TABS)[number];

export interface TabbedEvent {
	source: string;
	kind: string;
}

/** The tabs an event has, in order. */
export function eventTabs(evt: TabbedEvent): EventTab[] {
	return EVENT_TABS.filter(
		(t) =>
			(t !== 'production' || evt.source === 'cmc') && (t !== 'vendors' || evt.kind === 'market')
	);
}

/** The tab a `?tab=` value opens; one the event does not have opens Listing. */
export function parseEventTab(raw: string | null, evt: TabbedEvent): EventTab {
	return eventTabs(evt).find((t) => t === raw) ?? 'listing';
}

/** The page's address with a tab open. */
export function eventTabHref(id: string, tab: EventTab): ResolvedPathname {
	return withQuery(`/staff/events/${id}`, tab === 'listing' ? '' : `tab=${tab}`);
}
