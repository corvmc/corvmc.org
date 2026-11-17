import { getContext, setContext } from 'svelte';

/**
 * The toolbar's Assign opens the thread page's details strip, where the assignee
 * select lives. Context rather than module state, which SSR would share.
 */
class InboxToolbarState {
	detailsOpen = $state(false);
}

const KEY = Symbol('inbox-toolbar');

export function provideInboxToolbar(): InboxToolbarState {
	return setContext(KEY, new InboxToolbarState());
}

export function useInboxToolbar(): InboxToolbarState {
	return getContext<InboxToolbarState>(KEY);
}
