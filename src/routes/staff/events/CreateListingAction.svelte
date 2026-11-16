<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import CreateEventModal from '#lib/components/events/CreateEventModal.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	// Its own component so the page keeps one query of its own. The staff layout
	// has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	let open = $state(false);
</script>

<!-- A listing only: no production is opened unless Productions is asked for one. -->
{#if hasCapability(caps, 'event.manage')}
	<Button variant="default" size="sm" data-testid="create-listing" onclick={() => (open = true)}
		>{m.staff_create_listing_label()}</Button
	>
	<CreateEventModal
		bind:open
		title={m.staff_create_listing_title()}
		submitLabel={m.staff_create_listing_label()}
	/>
{/if}
