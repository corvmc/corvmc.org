<script lang="ts">
	/**
	 * The band's booking enquiries — the unified Messages list, scoped to this
	 * band's inbox (#1250).
	 *
	 * The route survives the unification rather than redirecting: the band nav
	 * row points at it, and every enquiry notification email deep-links into
	 * it. What changed is that it is now one view of one list rather than a
	 * second list that had drifted from the first.
	 */
	import { page } from '$app/state';
	import ConversationRows from '$lib/components/inbox/ConversationRows.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import { getMyMessages } from '$lib/remote/direct-messages.remote';
	import { enquiryList } from './list-state.svelte';

	const slug = $derived(page.params.slug!);
	// `channel: 'band'` — enquiries only. The band's own chat is the Chat row
	// next door, and this list showing both would double every group.
	const result = $derived(getMyMessages({ inbox: slug, channel: 'band', page: enquiryList.page }));
</script>

<div class="flex min-h-0 flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-xl font-bold">Messages</h1>
	</div>

	<p class="text-muted text-sm">
		Enquiries from your public booking form. Replies go back by email; nobody sees your address.
	</p>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<DataList
			{result}
			emptyTitle="No enquiries yet"
			empty="When someone uses the booking form on your profile, it lands here."
			onpage={(p) => (enquiryList.page = p)}
		>
			{#snippet children(rows)}
				<ConversationRows
					{rows}
					hrefFor={(id) => `/band/${slug}/messages/${id}`}
					showInbox={false}
				/>
			{/snippet}
		</DataList>
	</div>
</div>
