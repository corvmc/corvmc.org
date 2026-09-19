<script lang="ts">
	/**
	 * The band's inbox, two panes — and two lists in the left one. Chat and
	 * enquiries used to be two nav rows; they share a page now, kept visibly
	 * separate because their readers differ.
	 *
	 * The role check is **presentation only** — `requireGroupRole` in
	 * `band-messages.remote.ts` is the guard, and a remote function does not
	 * run inside this layout. It reads `userRole` off the layout context, the
	 * same value the nav uses, so the two cannot disagree.
	 */
	import { page } from '$app/state';
	import InboxShell from '$lib/components/inbox/InboxShell.svelte';
	import BandInbox from './BandInbox.svelte';
	import { getBandLayoutContext } from '../layout-context';

	let { children } = $props();

	const bandLayout = getBandLayoutContext();
	const role = $derived(bandLayout.current.userRole);
	const canReadEnquiries = $derived(role === 'owner' || role === 'admin');
	const chatUnread = $derived(bandLayout.current.chatUnread ?? 0);

	// Both panes count as "open" below `lg`: the chat is a conversation in the
	// right pane exactly as an enquiry is.
	const threadOpen = $derived(
		page.route.id === '/band/[slug]/messages/[id]' || page.route.id === '/band/[slug]/messages/chat'
	);
</script>

<InboxShell {threadOpen} {children}>
	{#snippet list()}
		<BandInbox {canReadEnquiries} {chatUnread} />
	{/snippet}
</InboxShell>
