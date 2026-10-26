import { getContext, setContext, type Snippet } from 'svelte';

/**
 * The inbox's one toolbar spans both panes, but its right half is the open
 * conversation's: the thread page hands its snippet up here, and the layout
 * draws it. Context rather than module state, which SSR would share.
 */
class InboxToolbarSlot {
	conversation = $state<Snippet | null>(null);
}

const KEY = Symbol('inbox-toolbar');

export function provideInboxToolbar(): InboxToolbarSlot {
	return setContext(KEY, new InboxToolbarSlot());
}

export function useInboxToolbar(): InboxToolbarSlot {
	return getContext<InboxToolbarSlot>(KEY);
}
