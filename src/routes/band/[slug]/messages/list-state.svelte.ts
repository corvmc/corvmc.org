import { getMyMessages } from '$lib/remote/direct-messages.remote';

/**
 * The enquiry list's page, and the one way to refresh it.
 *
 * Shared module state rather than a prop, because **queries are cached per
 * argument**: a refresh fired from inside the remote handler cannot know which
 * page the list is holding, so it would update an entry nothing renders. The
 * two panes are siblings — the list lives in `+layout.svelte` and the thread in
 * `[id]/+page.svelte` — so a callback prop has no path down to the list either.
 *
 * `/member/messages/list-state.svelte.ts` is the same shape and documents the
 * trap at length.
 */
export const enquiryList = $state({ page: 1 });

/**
 * Re-read the enquiry list at whatever page it is actually showing.
 *
 * `getMyMessages`, with the same three arguments `EnquiryList` passes. The
 * list is a scoped view of the unified query since #1250, so refreshing the
 * old `getBandConversations` entry updated something nothing renders — which
 * is the exact trap the header above warns about, sprung by the change that
 * moved the list. The symptom was an unread dot surviving the click that
 * marked it read.
 */
export function refreshEnquiries(slug: string): Promise<void> {
	return getMyMessages({ inbox: slug, channel: 'band', page: enquiryList.page }).refresh();
}
