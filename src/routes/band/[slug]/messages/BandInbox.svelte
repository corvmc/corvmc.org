<script lang="ts">
	/**
	 * The band's two inboxes, in one list pane. Separate lists on purpose:
	 * chat is the band talking to itself and every active member reads it,
	 * enquiries are strangers on the booking form and only admins read those.
	 * One stream would put an outsider in the middle of the band's own room.
	 * What is shared is the page — they were two nav rows before, so a member
	 * had to know which one a message came in on.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import EnquiryList from './EnquiryList.svelte';

	let { canReadEnquiries }: { canReadEnquiries: boolean } = $props();

	const slug = $derived(page.params.slug!);
	const chatHref = $derived(resolve('/band/[slug]/messages/chat', { slug }));
	const chatOpen = $derived(page.route.id === '/band/[slug]/messages/chat');
</script>

<div class="flex min-h-0 flex-col gap-6">
	<section>
		<SectionLabel label="Chat" />
		<!-- One row, because there is one room. It is a list rather than a link
		     so it reads as the other inbox's sibling. -->
		<a
			href={chatHref}
			aria-current={chatOpen ? 'page' : undefined}
			class="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-base-200 aria-[current=page]:bg-base-200"
		>
			<span class="font-medium">Everyone in the band</span>
		</a>
	</section>

	{#if canReadEnquiries}
		<section class="flex min-h-0 flex-col">
			<EnquiryList />
		</section>
	{/if}
</div>
