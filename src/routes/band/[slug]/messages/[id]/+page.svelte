<script lang="ts">
	/**
	 * One booking enquiry, in the band's own panel. The pane itself is
	 * `EnquiryThread`, shared with the member Messages list so a band admin
	 * reads the same thing from either place (#1250).
	 */
	import { page } from '$app/state';
	import ThreadPane from '$lib/components/inbox/ThreadPane.svelte';
	import EnquiryThread from '$lib/components/inbox/EnquiryThread.svelte';
	import { refreshEnquiries } from '../list-state.svelte';
	import { getBandConversation } from '$lib/remote/band-messages.remote';

	const slug = $derived(page.params.slug!);
	const threadId = $derived(page.params.id!);

	// Deliberately the only query this page awaits — and in particular not
	// getBandLayout(), which markBandConversationRead refreshes to update the
	// nav badge. Awaiting a query this component's own effect invalidates is an
	// effect_update_depth_exceeded loop.
	const t = $derived(await getBandConversation({ slug, threadId }));
</script>

<ThreadPane>
	<EnquiryThread
		thread={t}
		backHref="/band/{slug}/messages"
		onchanged={() => refreshEnquiries(slug)}
	/>
</ThreadPane>
