<script lang="ts">
	/**
	 * The band's two inboxes, in one list pane. Separate lists on purpose:
	 * chat is the band talking to itself and every active member reads it,
	 * enquiries are strangers on the booking form and only admins read those.
	 * One stream would put an outsider in the middle of the band's own room.
	 */
	import { page } from '$app/state';
	import EnquiryList from './EnquiryList.svelte';
	import GroupTopicList from '$lib/components/inbox/GroupTopicList.svelte';

	let { canReadEnquiries }: { canReadEnquiries: boolean } = $props();

	const slug = $derived(page.params.slug!);
</script>

<div class="flex min-h-0 flex-col gap-6">
	<GroupTopicList
		{slug}
		hrefFor={(threadId) => `/band/${slug}/messages/chat/${threadId}`}
		openThreadId={page.params.threadId ?? null}
	/>

	{#if canReadEnquiries}
		<section class="flex min-h-0 flex-col">
			<EnquiryList />
		</section>
	{/if}
</div>
