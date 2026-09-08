<script lang="ts">
	/**
	 * The band's inbox, two panes.
	 *
	 * The role check below is **presentation only**. `requireGroupRole` inside
	 * `band-messages.remote.ts` is the guard, and it is the only one — a remote
	 * function is its own endpoint and does not run inside this layout. What this
	 * fixes is a page that lied: a plain member reached the URL and got the shell,
	 * the heading, and "No enquiry selected", which reads as a band with no
	 * enquiries rather than a page that is not theirs. The nav row was already
	 * hidden from them; the page had not caught up.
	 *
	 * It reads `userRole` off the layout context rather than asking the server
	 * again — the same value the nav gating uses, so the two cannot disagree.
	 */
	import { page } from '$app/state';
	import InboxShell from '$lib/components/inbox/InboxShell.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import EnquiryList from './EnquiryList.svelte';
	import { getBandLayoutContext } from '../layout-context';

	let { children } = $props();

	const bandLayout = getBandLayoutContext();
	const role = $derived(bandLayout.current.userRole);
	const canRead = $derived(role === 'owner' || role === 'admin');

	const threadOpen = $derived(page.route.id === '/band/[slug]/messages/[id]');
</script>

{#if canRead}
	<InboxShell {threadOpen} {children}>
		{#snippet list()}
			<EnquiryList />
		{/snippet}
	</InboxShell>
{:else}
	<div class="flex h-full items-center justify-center py-6">
		<EmptyState
			title="Booking enquiries are for band admins"
			description="Whoever runs bookings for this band can read and answer them. Ask an admin if you need access."
		/>
	</div>
{/if}
