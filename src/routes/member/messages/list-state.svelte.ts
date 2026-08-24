import { getMyMessages } from '$lib/remote/direct-messages.remote';

/**
 * The conversation list's page, and the one way to refresh it.
 *
 * Shared module state rather than a prop or a server-side `.refresh()`, because
 * **queries are cached per argument**. `getMyMessages()` and
 * `getMyMessages({ page: 1 })` are two different cache entries, so a refresh
 * from inside the remote handler — which cannot know the page the list is
 * holding — updates an entry nothing renders. That is the same trap the
 * mutations were already in: they refreshed `getMyDirectThreads()`, which no UI
 * has ever read. `suggestions.remote.ts` documents the rule.
 *
 * A module rather than a callback prop because the two panes are siblings: the
 * list lives in `+layout.svelte` and the thread in `[id]/+page.svelte`, so
 * accepting a request has no path down to the list's own state.
 */
export const conversationList = $state({ page: 1 });

/** Re-read the conversation list at whatever page it is actually showing. */
export function refreshConversations(): Promise<void> {
	return getMyMessages({ page: conversationList.page }).refresh();
}
