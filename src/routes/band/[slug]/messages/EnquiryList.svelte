<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The band's booking enquiries — the unified Messages list, scoped to this
	 * band's inbox (#1250).
	 *
	 * The route survives the unification rather than redirecting: the band nav
	 * row points at it, and every enquiry notification email deep-links into
	 * it. What changed is that it is now one view of one list rather than a
	 * second list that had drifted from the first.
	 */
	import ConversationRows from '#lib/components/inbox/ConversationRows.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import { getMyMessages } from '#lib/remote/direct-messages.remote.js';
	import { enquiryList } from './list-state.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug');

	const slug = $derived(params.slug);
	// `channel: 'band'` — enquiries only. The band's own chat is the Chat row
	// next door, and this list showing both would double every group.
	const result = $derived(getMyMessages({ inbox: slug, channel: 'band', page: enquiryList.page }));
</script>

<div class="flex min-h-0 flex-col gap-3" data-testid="enquiry-list">
	<!-- "Enquiries", not "Messages": Messages is the page, and this is one of
	     the two lists on it. -->
	<SectionLabel label={m.band_slug_messages_enquiry_list_label()} />

	<p class="text-muted text-sm">
		{m.band_slug_messages_enquiry_list_enquiries_from_public_bookin_text()}
	</p>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<DataList
			{result}
			emptyTitle={m.band_slug_messages_enquiry_list_empty_title()}
			empty={m.band_slug_messages_enquiry_list_empty_body()}
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
