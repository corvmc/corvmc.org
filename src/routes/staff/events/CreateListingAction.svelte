<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import CreateEventModal from '$lib/components/events/CreateEventModal.svelte';
	import { hasCapability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';

	// Its own component so the page keeps one query of its own. The staff layout
	// has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	let open = $state(false);
</script>

<!-- A listing only: no production is opened unless Productions is asked for one. -->
{#if hasCapability(caps, 'event.manage')}
	<Button variant="default" size="sm" onclick={() => (open = true)}>Create Listing</Button>
	<CreateEventModal bind:open title="Create Listing" submitLabel="Create Listing" />
{/if}
