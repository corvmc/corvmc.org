<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * The desktop right pane with nothing open. On a phone this route renders only
	 * the list — `InboxShell` hides this pane below `lg` — so it is never the whole
	 * screen, and does not need to be.
	 *
	 * Worded for whichever lists the reader actually has: a plain member has one
	 * and would not know what an enquiry was.
	 */
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getBandLayoutContext } from '../layout-context';

	const bandLayout = getBandLayoutContext();
	const role = $derived(bandLayout.current.userRole);
	const canReadEnquiries = $derived(role === 'owner' || role === 'admin');
</script>

<div class="flex h-full items-center justify-center">
	<EmptyState
		title={m.band_slug_messages_title()}
		description={canReadEnquiries
			? m.band_slug_messages_open_band_s_chat_pick()
			: m.band_slug_messages_open_band_s_chat_from()}
	/>
</div>
